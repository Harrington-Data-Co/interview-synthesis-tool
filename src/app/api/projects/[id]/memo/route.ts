import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { ClaudeError, EFFORT, MODEL, type Usage } from "@/lib/claude/call";
import { claudeErrorResponse } from "@/lib/claude/respond";
import { gateParagraphs } from "@/lib/memo/gate";
import { loadMemo } from "@/lib/memo/load";
import { MEMO_PROMPT_VERSION, type MemoTheme } from "@/lib/memo/prompt";
import { writeMemo } from "@/lib/memo/run";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Write the project's findings memo from a memo template and its confirmed
 *  themes. Body: { templateId, replace?: boolean }. A memo with generated
 *  paragraphs is refused (409) unless `replace` is set; a new generation
 *  replaces the previous one's paragraphs and open proposals — never
 *  paragraphs people wrote — once the new ones are in hand. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  let runId: string | null = null;
  const supabase = await createClient();
  try {
    await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown project.", 404);
    const body = (await request.json().catch(() => ({}))) as { templateId?: unknown; replace?: unknown };
    if (typeof body.templateId !== "string" || !UUID.test(body.templateId)) throw new ApiError("Choose a memo template.");

    const memo = await loadMemo(supabase, id, body.templateId);
    if (!memo) throw new ApiError("Unknown project.", 404);
    const template = memo.template;
    if (!template || template.id !== body.templateId) throw new ApiError("That template isn't one of this project's memo templates.");
    if (!template.sections.length) throw new ApiError("This memo template has no sections yet. Add some on the Templates page.");

    const confirmed = memo.themes.filter((t) => t.status === "confirmed" && t.codeIds.length);
    if (!confirmed.length && template.sections.some((s) => s.requires.includes("themes"))) {
      throw new ApiError("Confirm some themes first — the memo is written from confirmed themes.");
    }
    const codeById = new Map(memo.codes.map((c) => [c.id, c]));
    const themes: MemoTheme[] = confirmed.map((t) => ({
      id: t.id,
      ref: t.ref,
      title: t.title,
      description: null,
      codeIds: t.codeIds,
      interviews: new Set(t.codeIds.map((cid) => codeById.get(cid)?.transcriptId)).size,
    }));
    const { data: descriptions } = await supabase.from("theme").select("id,description").in("id", themes.map((t) => t.id));
    for (const d of descriptions ?? []) {
      const t = themes.find((x) => x.id === d.id);
      if (t) t.description = d.description;
    }

    const claudeParagraphs = memo.paragraphs.filter((p) => p.origin === "claude").length;
    if (claudeParagraphs && !body.replace) {
      throw new ApiError(`This memo already has ${claudeParagraphs} generated paragraphs. Regenerate to replace them.`, 409);
    }

    const { data: run, error: startError } = await supabase.rpc("start_product_run", {
      p_project_id: id,
      p_template_id: template.id,
      p_model: MODEL,
      p_effort: EFFORT,
      p_prompt_version: MEMO_PROMPT_VERSION,
    });
    if (startError) {
      if (startError.code === "P0001") throw new ApiError(startError.message, 409);
      throw startError;
    }
    runId = run as string;

    const { title, proposals, usage } = await writeMemo(
      { project: memo.project.name, client: memo.project.client, interviews: memo.interviews.length, templateName: template.name },
      template.sections,
      themes,
      memo.codes,
    );
    const { accepted, rejected } = gateParagraphs(proposals, template.sections, themes, memo.codes);

    if (memo.product) {
      const { error } = await supabase.rpc("discard_claude_product_items", { p_product_id: memo.product.id });
      if (error) throw error;
    }
    const { data: saved, error: saveError } = await supabase.rpc("save_product_run", {
      p_run_id: runId,
      p_title: title,
      p_items: accepted,
      p_rejections: rejected,
      p_usage: usage,
    });
    if (saveError) throw saveError;
    return Response.json({ runId, ...(saved as { product_id: string; accepted: number; rejected: number }), costUsd: usage.cost_usd });
  } catch (e) {
    if (runId) {
      const usage: Partial<Usage> = e instanceof ClaudeError ? e.usage : {};
      await supabase.rpc("fail_product_run", { p_run_id: runId, p_error: e instanceof Error ? e.message : String(e), p_usage: usage });
    }
    return claudeErrorResponse(e) ?? errorResponse(e);
  }
}
