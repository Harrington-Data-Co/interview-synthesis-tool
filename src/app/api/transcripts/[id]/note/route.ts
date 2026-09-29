import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { ClaudeError, EFFORT, MODEL, type Usage } from "@/lib/claude/call";
import { claudeErrorResponse } from "@/lib/claude/respond";
import { gateItems } from "@/lib/notes/gate";
import { NOTE_PROMPT_VERSION, type NoteCode, type NoteSection } from "@/lib/notes/prompt";
import { writeNote } from "@/lib/notes/run";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Generate an interview note from a template.
 *
 *  Body: { templateId, replace?: boolean }. A note that already has Claude's
 *  items is refused (409) unless `replace` is set. A new generation replaces
 *  the previous one's items and open proposals — never items people wrote —
 *  once the new ones are in hand. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  let runId: string | null = null;
  const supabase = await createClient();
  try {
    await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown transcript.", 404);
    const body = (await request.json().catch(() => ({}))) as { templateId?: unknown; replace?: unknown };
    if (typeof body.templateId !== "string" || !UUID.test(body.templateId)) throw new ApiError("Choose a template.");
    const templateId = body.templateId;

    const [{ data: t }, { data: tpl }, { data: codeRows }, { data: speakers }, { data: existing }] = await Promise.all([
      supabase.from("transcript").select("id,title,participant,project_id").eq("id", id).maybeSingle(),
      supabase
        .from("note_template")
        .select("id,name,scope,project_id,sections:note_section(id,ordinal,name,requires,note)")
        .eq("id", templateId)
        .maybeSingle(),
      supabase
        .from("code")
        .select("id,ref,type,label,verbatim,note,line_start,line_end")
        .eq("transcript_id", id)
        .is("merged_into_id", null)
        .order("line_start"),
      supabase.from("transcript_speaker").select("name,display_name,role").eq("transcript_id", id),
      supabase.from("note").select("id").eq("transcript_id", id).eq("template_id", templateId).maybeSingle(),
    ]);
    if (!t) throw new ApiError("Unknown transcript.", 404);
    if (!tpl) throw new ApiError("Unknown template.", 404);
    if (!t.project_id || tpl.project_id !== t.project_id) {
      throw new ApiError("That template isn't one of this interview's project's templates.");
    }
    const sections: NoteSection[] = [...(tpl.sections ?? [])]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({ id: s.id, name: s.name, requires: s.requires ?? [], note: s.note }));
    if (!sections.length) throw new ApiError("This template has no sections yet. Add some on the Templates page.");
    const codes = (codeRows ?? []) as NoteCode[];
    if (!codes.length) throw new ApiError("This interview has no codes yet. Code it first.");

    let claudeItems = 0;
    if (existing) {
      const { count } = await supabase
        .from("note_item")
        .select("id", { count: "exact", head: true })
        .eq("note_id", existing.id)
        .eq("origin", "claude");
      claudeItems = count ?? 0;
      if (claudeItems && !body.replace) {
        throw new ApiError(`This note already has ${claudeItems} generated items. Regenerate to replace them.`, 409);
      }
    }

    const { data: run, error: startError } = await supabase.rpc("start_note_run", {
      p_transcript_id: id,
      p_template_id: templateId,
      p_model: MODEL,
      p_effort: EFFORT,
      p_prompt_version: NOTE_PROMPT_VERSION,
    });
    if (startError) {
      if (startError.code === "P0001") throw new ApiError(startError.message, 409);
      throw startError;
    }
    runId = run as string;

    const participant =
      (speakers ?? [])
        .filter((s) => s.role === "participant")
        .map((s) => s.display_name ?? s.name)
        .join(", ") || t.participant;
    const { proposals, usage } = await writeNote(
      { title: t.title, participant, templateName: tpl.name, templateScope: tpl.scope },
      sections,
      codes,
    );
    const { accepted, rejected } = gateItems(proposals, sections, codes);

    // Only now, with the new items in hand, clear the previous generation:
    // its items (when replacing) and its proposals still awaiting review —
    // even when none of its items survived, as when every one was rejected.
    if (existing) {
      const { error } = await supabase.rpc("discard_claude_note_items", { p_note_id: existing.id });
      if (error) throw error;
    }

    const { data: saved, error: saveError } = await supabase.rpc("save_note_run", {
      p_run_id: runId,
      p_items: accepted,
      p_rejections: rejected,
      p_usage: usage,
    });
    if (saveError) throw saveError;
    return Response.json({ runId, ...(saved as { note_id: string; accepted: number; rejected: number }), costUsd: usage.cost_usd });
  } catch (e) {
    if (runId) {
      const usage: Partial<Usage> = e instanceof ClaudeError ? e.usage : {};
      await supabase.rpc("fail_note_run", { p_run_id: runId, p_error: e instanceof Error ? e.message : String(e), p_usage: usage });
    }
    return claudeErrorResponse(e) ?? errorResponse(e);
  }
}
