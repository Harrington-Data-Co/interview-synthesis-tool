import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const uuids = (v: unknown, what: string) => (Array.isArray(v) ? v.map((x) => uuid(x, what)) : []);
const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 6000) : undefined);

/** People's changes to a memo: its paragraphs and its headline, each through
 *  a database function that checks citations and logs the change.
 *
 *  Body: { action, ... }
 *    create  { sectionId, text, themeIds[], codeIds[], rejectionId? }  → { id }
 *    update  { itemId, changes: { text?, sectionId?, themeIds?, codeIds? } }
 *    move    { itemId, delta: -1 | 1 }
 *    delete  { itemId }
 *    revert  { itemId }
 *    dismiss { rejectionId }
 *    title   { title } */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id: productId } = await ctx.params;
    if (!UUID.test(productId)) throw new ApiError("Unknown memo.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();

    const inMemo = async (itemId: string) => {
      const { count } = await supabase
        .from("product_item")
        .select("id", { count: "exact", head: true })
        .eq("id", itemId)
        .eq("product_id", productId);
      if (!count) throw new ApiError("That paragraph isn't part of this memo.", 404);
      return itemId;
    };

    let result: unknown = null;
    let error: { code?: string; message: string } | null = null;
    switch (body.action) {
      case "create":
        ({ data: result, error } = await supabase.rpc("create_product_item", {
          p_product_id: productId,
          p_section_id: uuid(body.sectionId, "section"),
          p_text: text(body.text) ?? "",
          p_theme_ids: uuids(body.themeIds, "theme"),
          p_code_ids: uuids(body.codeIds, "code"),
          p_rejection_id: body.rejectionId ? uuid(body.rejectionId, "proposal") : null,
        }));
        break;
      case "update": {
        const itemId = await inMemo(uuid(body.itemId, "paragraph"));
        const c = (body.changes ?? {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        if (c.text !== undefined) changes.text = text(c.text);
        if (c.sectionId !== undefined) changes.section_id = uuid(c.sectionId, "section");
        if (c.themeIds !== undefined) changes.theme_ids = uuids(c.themeIds, "theme");
        if (c.codeIds !== undefined) changes.code_ids = uuids(c.codeIds, "code");
        ({ data: result, error } = await supabase.rpc("update_product_item", { p_item_id: itemId, p_changes: changes }));
        break;
      }
      case "move":
        ({ error } = await supabase.rpc("move_product_item", {
          p_item_id: await inMemo(uuid(body.itemId, "paragraph")),
          p_delta: body.delta === -1 ? -1 : 1,
        }));
        break;
      case "delete":
        ({ error } = await supabase.rpc("delete_product_item", { p_item_id: await inMemo(uuid(body.itemId, "paragraph")) }));
        break;
      case "revert":
        ({ data: result, error } = await supabase.rpc("revert_last_product_item_edit", {
          p_item_id: await inMemo(uuid(body.itemId, "paragraph")),
        }));
        break;
      case "dismiss": {
        const rejectionId = uuid(body.rejectionId, "proposal");
        const { count } = await supabase
          .from("product_item_rejection")
          .select("id", { count: "exact", head: true })
          .eq("id", rejectionId)
          .eq("product_id", productId);
        if (!count) throw new ApiError("That proposal isn't part of this memo.", 404);
        ({ error } = await supabase.rpc("dismiss_product_rejection", { p_rejection_id: rejectionId }));
        break;
      }
      case "title":
        ({ error } = await supabase.rpc("set_product_title", { p_product_id: productId, p_title: text(body.title) ?? "" }));
        break;
      default:
        throw new ApiError("Unknown action.");
    }

    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't change the memo.", 403);
      if (error.code === "P0002") throw new ApiError("That no longer exists.", 404);
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "23514") throw new ApiError("A paragraph needs some text.");
      throw error;
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
