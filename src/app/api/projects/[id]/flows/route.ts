import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { ClaudeError, EFFORT, MODEL, type Usage } from "@/lib/claude/call";
import { claudeErrorResponse } from "@/lib/claude/respond";
import { gateMaps } from "@/lib/flow/gate";
import { loadFlows } from "@/lib/flow/load";
import { FLOW_CODE_TYPES, FLOW_PROMPT_VERSION, type FlowCode } from "@/lib/flow/prompt";
import { drawMaps } from "@/lib/flow/run";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A project's process maps.
 *
 *  Body: { action, ... }
 *    draw   { replace?: boolean }  Claude drafts maps from the project's Step,
 *           Tool, Stakeholder, Pain and Constraint codes. Maps nobody has
 *           edited are replaced, which needs `replace` when there are any
 *           (409 otherwise); maps a person has edited are always kept.
 *    create { title, scope? }      → { id }  An empty map to fill by hand. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  let runId: string | null = null;
  const supabase = await createClient();
  try {
    await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown project.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "create") {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";
      if (!title) throw new ApiError("A process map needs a title.");
      const { data, error } = await supabase.rpc("create_flow", {
        p_project_id: id,
        p_title: title,
        p_scope: typeof body.scope === "string" ? body.scope.slice(0, 1000) : null,
      });
      if (error) throw error.code === "42501" ? new ApiError("Viewers can't add process maps.", 403) : error;
      return Response.json({ id: data });
    }
    if (body.action !== "draw") throw new ApiError("Unknown action.");

    const loaded = await loadFlows(supabase, id);
    if (!loaded) throw new ApiError("Unknown project.", 404);
    const codes: FlowCode[] = loaded.codes.filter((c) => (FLOW_CODE_TYPES as readonly string[]).includes(c.type));
    if (!codes.some((c) => c.type === "Step")) {
      throw new ApiError("There are no Step codes to draw a process from yet. Code some interviews first.");
    }
    const replaced = loaded.flows.filter((f) => f.origin === "claude" && !f.touched).length;
    if (replaced && !body.replace) {
      throw new ApiError(`Redrawing replaces ${replaced} map${replaced === 1 ? "" : "s"} nobody has edited. Maps you've edited are kept.`, 409);
    }

    const [{ data: themes }] = await Promise.all([
      supabase.from("theme").select("ref,title").eq("project_id", id).eq("status", "confirmed").order("ordinal"),
    ]);

    const { data: run, error: startError } = await supabase.rpc("start_flow_run", {
      p_project_id: id,
      p_model: MODEL,
      p_effort: EFFORT,
      p_prompt_version: FLOW_PROMPT_VERSION,
    });
    if (startError) {
      if (startError.code === "P0001") throw new ApiError(startError.message, 409);
      throw startError;
    }
    runId = run as string;

    const { proposals, usage } = await drawMaps(
      {
        project: loaded.project.name,
        client: loaded.project.client,
        interviews: loaded.interviews.map((i) => ({ key: i.key, role: i.role, organization: i.organization })),
      },
      themes ?? [],
      codes,
    );
    const { maps, rejected } = gateMaps(proposals, codes);
    const { data: saved, error: saveError } = await supabase.rpc("save_flow_run", {
      p_run_id: runId,
      p_flows: maps,
      p_rejections: rejected,
      p_usage: usage,
    });
    if (saveError) throw saveError;
    return Response.json({ runId, ...(saved as { maps: number; accepted: number; rejected: number }), costUsd: usage.cost_usd });
  } catch (e) {
    if (runId) {
      const usage: Partial<Usage> = e instanceof ClaudeError ? e.usage : {};
      await supabase.rpc("fail_flow_run", { p_run_id: runId, p_error: e instanceof Error ? e.message : String(e), p_usage: usage });
    }
    return claudeErrorResponse(e) ?? errorResponse(e);
  }
}
