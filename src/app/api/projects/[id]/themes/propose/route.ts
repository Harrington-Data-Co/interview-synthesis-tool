import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { ClaudeError, EFFORT, MODEL, type Usage } from "@/lib/claude/call";
import { claudeErrorResponse } from "@/lib/claude/respond";
import { loadProjectEvidence } from "@/lib/themes/evidence";
import { gateThemes } from "@/lib/themes/gate";
import { THEME_PROMPT_VERSION } from "@/lib/themes/prompt";
import { proposeThemes } from "@/lib/themes/run";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Propose themes across the project's coded interviews. A new proposal
 *  replaces the previous one's unconfirmed themes and open rejections —
 *  once it's in hand; confirmed themes, and any a memo cites, stay. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  let runId: string | null = null;
  const supabase = await createClient();
  try {
    await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown project.", 404);

    const [{ data: project }, evidence, { data: confirmed }] = await Promise.all([
      supabase.from("project").select("id,name").eq("id", id).maybeSingle(),
      loadProjectEvidence(supabase, id),
      supabase.from("theme").select("ref,title").eq("project_id", id).eq("status", "confirmed").order("ordinal"),
    ]);
    if (!project) throw new ApiError("Unknown project.", 404);
    if (!evidence.codes.length) throw new ApiError("No interview in this project has been coded yet.");

    const { data: run, error: startError } = await supabase.rpc("start_theme_run", {
      p_project_id: id,
      p_model: MODEL,
      p_effort: EFFORT,
      p_prompt_version: THEME_PROMPT_VERSION,
    });
    if (startError) {
      if (startError.code === "P0001") throw new ApiError(startError.message, 409);
      throw startError;
    }
    runId = run as string;

    const { proposals, usage } = await proposeThemes(project.name, evidence.interviews, confirmed ?? [], evidence.codes);
    const { accepted, rejected } = gateThemes(proposals, evidence.codes);

    const { error: discardError } = await supabase.rpc("discard_proposed_themes", { p_project_id: id });
    if (discardError) throw discardError;
    const { data: saved, error: saveError } = await supabase.rpc("save_theme_run", {
      p_run_id: runId,
      p_themes: accepted,
      p_rejections: rejected,
      p_usage: usage,
    });
    if (saveError) throw saveError;
    return Response.json({ runId, ...(saved as { accepted: number; rejected: number }), costUsd: usage.cost_usd });
  } catch (e) {
    if (runId) {
      const usage: Partial<Usage> = e instanceof ClaudeError ? e.usage : {};
      await supabase.rpc("fail_theme_run", { p_run_id: runId, p_error: e instanceof Error ? e.message : String(e), p_usage: usage });
    }
    return claudeErrorResponse(e) ?? errorResponse(e);
  }
}
