import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const uuids = (v: unknown) => (Array.isArray(v) ? v.map((x) => uuid(x, "code")) : []);
const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 4000) : undefined);

/** People's changes to a note's items. Each goes through a database function
 *  that checks citations and logs the change with its before and after values.
 *
 *  Body: { action, ... }
 *    create  { sectionId, text, codeIds[], rejectionId? }  → { id }
 *    update  { itemId, changes: { text?, sectionId?, codeIds? } }
 *    move    { itemId, delta: -1 | 1 }
 *    delete  { itemId }
 *    revert  { itemId }                — undoes the item's latest edit
 *    dismiss { rejectionId }           — a generated item not worth keeping */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id: noteId } = await ctx.params;
    if (!UUID.test(noteId)) throw new ApiError("Unknown note.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();

    const inNote = async (itemId: string) => {
      const { count } = await supabase
        .from("note_item")
        .select("id", { count: "exact", head: true })
        .eq("id", itemId)
        .eq("note_id", noteId);
      if (!count) throw new ApiError("That item isn't part of this note.", 404);
      return itemId;
    };

    let result: unknown = null;
    let error: { code?: string; message: string } | null = null;
    switch (body.action) {
      case "create":
        ({ data: result, error } = await supabase.rpc("create_note_item", {
          p_note_id: noteId,
          p_section_id: uuid(body.sectionId, "section"),
          p_text: text(body.text) ?? "",
          p_code_ids: uuids(body.codeIds),
          p_rejection_id: body.rejectionId ? uuid(body.rejectionId, "proposal") : null,
        }));
        break;
      case "update": {
        const itemId = await inNote(uuid(body.itemId, "item"));
        const c = (body.changes ?? {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        if (c.text !== undefined) changes.text = text(c.text);
        if (c.sectionId !== undefined) changes.section_id = uuid(c.sectionId, "section");
        if (c.codeIds !== undefined) changes.code_ids = uuids(c.codeIds);
        ({ data: result, error } = await supabase.rpc("update_note_item", { p_item_id: itemId, p_changes: changes }));
        break;
      }
      case "move":
        ({ error } = await supabase.rpc("move_note_item", {
          p_item_id: await inNote(uuid(body.itemId, "item")),
          p_delta: body.delta === -1 ? -1 : 1,
        }));
        break;
      case "delete":
        ({ error } = await supabase.rpc("delete_note_item", { p_item_id: await inNote(uuid(body.itemId, "item")) }));
        break;
      case "revert":
        ({ data: result, error } = await supabase.rpc("revert_last_note_item_edit", {
          p_item_id: await inNote(uuid(body.itemId, "item")),
        }));
        break;
      case "dismiss": {
        const rejectionId = uuid(body.rejectionId, "proposal");
        const { count } = await supabase
          .from("note_item_rejection")
          .select("id", { count: "exact", head: true })
          .eq("id", rejectionId)
          .eq("note_id", noteId);
        if (!count) throw new ApiError("That proposal isn't part of this note.", 404);
        ({ error } = await supabase.rpc("dismiss_note_rejection", { p_rejection_id: rejectionId }));
        break;
      }
      default:
        throw new ApiError("Unknown action.");
    }

    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't change notes.", 403);
      if (error.code === "P0002") throw new ApiError("That item no longer exists.", 404);
      // The citation rules' own refusals are written for people.
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "23514") throw new ApiError("An item needs some text.");
      throw error;
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
