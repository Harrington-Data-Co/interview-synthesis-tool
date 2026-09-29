import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = ["Pain", "Step", "Tool", "Goal", "Constraint", "Question", "Quote", "Stakeholder"];

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const line = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined);

/** People's changes to a transcript's codes. Each goes through a database
 *  function that checks the quote, logs the change with its before and after
 *  values, and records activity.
 *
 *  Body: { action, ... }
 *    create   { type, label, verbatim, line_start, line_end, note?, rejectionId? }  → { id }
 *    update   { codeId, changes: { type?, label?, note?, verbatim?, line_start?, line_end? } }
 *    delete   { codeId }
 *    revert   { codeId }                  — undoes the code's latest edit
 *    merge    { keepId, mergeIds[] }
 *    dismiss  { rejectionId }             — a proposal of Claude's not worth keeping */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id: transcriptId } = await ctx.params;
    if (!UUID.test(transcriptId)) throw new ApiError("Unknown transcript.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();

    // Every code touched must belong to this transcript.
    const inTranscript = async (ids: string[]) => {
      const { count } = await supabase
        .from("code")
        .select("id", { count: "exact", head: true })
        .eq("transcript_id", transcriptId)
        .in("id", ids);
      if (count !== ids.length) throw new ApiError("That code isn't part of this transcript.", 404);
    };

    let result: unknown = null;
    let error: { code?: string; message: string } | null = null;

    switch (body.action) {
      case "create": {
        if (!TYPES.includes(body.type as string)) throw new ApiError("Choose a code type.");
        ({ data: result, error } = await supabase.rpc("create_code", {
          p_transcript_id: transcriptId,
          p_type: body.type,
          p_label: text(body.label, 200) ?? "",
          p_verbatim: text(body.verbatim, 4000) ?? "",
          p_line_start: line(body.line_start),
          p_line_end: line(body.line_end),
          p_note: text(body.note, 1000) ?? null,
          p_rejection_id: body.rejectionId ? uuid(body.rejectionId, "proposal") : null,
        }));
        break;
      }
      case "update": {
        const codeId = uuid(body.codeId, "code");
        await inTranscript([codeId]);
        const c = (body.changes ?? {}) as Record<string, unknown>;
        if (c.type !== undefined && !TYPES.includes(c.type as string)) throw new ApiError("Choose a code type.");
        const changes = Object.fromEntries(
          Object.entries({
            type: c.type,
            label: text(c.label, 200),
            note: c.note === null ? "" : text(c.note, 1000),
            verbatim: text(c.verbatim, 4000),
            line_start: line(c.line_start),
            line_end: line(c.line_end),
          }).filter(([, v]) => v !== undefined),
        );
        ({ data: result, error } = await supabase.rpc("update_code", { p_code_id: codeId, p_changes: changes }));
        break;
      }
      case "delete": {
        const codeId = uuid(body.codeId, "code");
        await inTranscript([codeId]);
        ({ error } = await supabase.rpc("delete_code", { p_code_id: codeId }));
        break;
      }
      case "revert": {
        const codeId = uuid(body.codeId, "code");
        await inTranscript([codeId]);
        ({ data: result, error } = await supabase.rpc("revert_last_code_edit", { p_code_id: codeId }));
        break;
      }
      case "merge": {
        const keepId = uuid(body.keepId, "code");
        const mergeIds = Array.isArray(body.mergeIds) ? body.mergeIds.map((m) => uuid(m, "code")) : [];
        if (!mergeIds.length) throw new ApiError("Choose codes to merge.");
        await inTranscript([keepId, ...mergeIds]);
        ({ data: result, error } = await supabase.rpc("merge_codes", { p_keep: keepId, p_merge: mergeIds }));
        break;
      }
      case "dismiss": {
        const rejectionId = uuid(body.rejectionId, "proposal");
        const { count } = await supabase
          .from("code_rejection")
          .select("id", { count: "exact", head: true })
          .eq("id", rejectionId)
          .eq("transcript_id", transcriptId);
        if (!count) throw new ApiError("That proposal isn't part of this transcript.", 404);
        ({ error } = await supabase.rpc("dismiss_rejection", { p_rejection_id: rejectionId }));
        break;
      }
      default:
        throw new ApiError("Unknown action.");
    }

    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't change codes.", 403);
      if (error.code === "P0002") throw new ApiError("That code no longer exists.", 404);
      // The database's own refusals — the quote check above all — are written for people.
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "23503") throw new ApiError("Those lines don't exist in this transcript.");
      throw error;
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
