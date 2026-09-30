import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { ClaudeError, EFFORT, MODEL, type Usage } from "@/lib/claude/call";
import { claudeErrorResponse } from "@/lib/claude/respond";
import { gateSlides } from "@/lib/deck/gate";
import { loadDeck } from "@/lib/deck/load";
import { DECK_PROMPT_VERSION } from "@/lib/deck/prompt";
import { writeDeck } from "@/lib/deck/run";
import type { MemoTheme } from "@/lib/memo/prompt";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Write the project's deck from a deck template and its confirmed themes.
 *  Body: { templateId, replace?: boolean }. A deck with Claude's slides is
 *  refused (409) unless `replace` is set; a rewrite replaces Claude's slides
 *  and open proposals, never slides people wrote or edited. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  let runId: string | null = null;
  const supabase = await createClient();
  try {
    await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown project.", 404);
    const body = (await request.json().catch(() => ({}))) as { templateId?: unknown; replace?: unknown };
    if (typeof body.templateId !== "string" || !UUID.test(body.templateId)) throw new ApiError("Choose a deck template.");

    const deck = await loadDeck(supabase, id, body.templateId);
    if (!deck) throw new ApiError("Unknown project.", 404);
    const template = deck.template;
    if (!template || template.id !== body.templateId) throw new ApiError("That template isn't one of this project's deck templates.");
    if (!template.sections.length) throw new ApiError("This deck template has no sections yet. Add some on the Templates page.");

    const confirmed = deck.themes.filter((t) => t.status === "confirmed" && t.codeIds.length);
    if (!confirmed.length && template.sections.some((s) => s.requires.includes("themes"))) {
      throw new ApiError("Confirm some themes first — the deck is written from confirmed themes.");
    }
    const codeById = new Map(deck.codes.map((c) => [c.id, c]));
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

    const claudeSlides = deck.slides.filter((s) => s.origin === "claude").length;
    if (claudeSlides && !body.replace) {
      throw new ApiError(`This deck already has ${claudeSlides} generated slides. Rewrite to replace them; slides you've edited are kept.`, 409);
    }

    const { data: run, error: startError } = await supabase.rpc("start_product_run", {
      p_project_id: id,
      p_template_id: template.id,
      p_model: MODEL,
      p_effort: EFFORT,
      p_prompt_version: DECK_PROMPT_VERSION,
    });
    if (startError) {
      if (startError.code === "P0001") throw new ApiError(startError.message, 409);
      throw startError;
    }
    runId = run as string;

    const { title, proposals, usage } = await writeDeck(
      { project: deck.project.name, client: deck.project.client, interviews: deck.interviews.length, templateName: template.name },
      template.sections,
      themes,
      deck.codes,
    );
    const { accepted, rejected } = gateSlides(proposals, template.sections, themes, deck.codes);
    const { data: saved, error: saveError } = await supabase.rpc("save_deck_run", {
      p_run_id: runId,
      p_title: title,
      p_slides: accepted,
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
