import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYOUTS = ["finding", "quote", "statement"];

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const uuids = (v: unknown, what: string) => (Array.isArray(v) ? v.map((x) => uuid(x, what)) : []);
const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const bullets = (v: unknown) => (Array.isArray(v) ? v.filter((b): b is string => typeof b === "string").map((b) => b.slice(0, 400)).slice(0, 6) : []);
const layout = (v: unknown) => {
  if (typeof v !== "string" || !LAYOUTS.includes(v)) throw new ApiError("A slide is a finding, a quote or a statement.");
  return v;
};

/** People's changes to a deck, each through a database function that checks
 *  citations and logs the change.
 *
 *  Body: { action, ... }
 *    create  { sectionId, layout, title, bullets[], quoteCodeId?, notes?, themeIds[], codeIds[], rejectionId? } → { id }
 *    update  { slideId, changes: { sectionId?, layout?, title?, bullets?, quoteCodeId?, notes?, themeIds?, codeIds? } }
 *    move    { slideId, delta: -1 | 1 }
 *    delete  { slideId }
 *    revert  { slideId }
 *    dismiss { rejectionId }
 *    title   { title } */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id: productId } = await ctx.params;
    if (!UUID.test(productId)) throw new ApiError("Unknown deck.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();

    const inDeck = async (slideId: string) => {
      const { count } = await supabase.from("deck_slide").select("id", { count: "exact", head: true }).eq("id", slideId).eq("product_id", productId);
      if (!count) throw new ApiError("That slide isn't part of this deck.", 404);
      return slideId;
    };

    let result: unknown = null;
    let error: { code?: string; message: string } | null = null;
    switch (body.action) {
      case "create":
        ({ data: result, error } = await supabase.rpc("create_deck_slide", {
          p_product_id: productId,
          p_section_id: uuid(body.sectionId, "section"),
          p_layout: layout(body.layout),
          p_title: text(body.title, 300) ?? "",
          p_bullets: bullets(body.bullets),
          p_quote_code_id: body.quoteCodeId ? uuid(body.quoteCodeId, "quote") : null,
          p_notes: text(body.notes) ?? null,
          p_theme_ids: uuids(body.themeIds, "theme"),
          p_code_ids: uuids(body.codeIds, "code"),
          p_rejection_id: body.rejectionId ? uuid(body.rejectionId, "proposal") : null,
        }));
        break;
      case "update": {
        const slideId = await inDeck(uuid(body.slideId, "slide"));
        const c = (body.changes ?? {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        if (c.sectionId !== undefined) changes.section_id = uuid(c.sectionId, "section");
        if (c.layout !== undefined) changes.layout = layout(c.layout);
        if (c.title !== undefined) changes.title = text(c.title, 300);
        if (c.bullets !== undefined) changes.bullets = bullets(c.bullets);
        if (c.quoteCodeId !== undefined) changes.quote_code_id = c.quoteCodeId ? uuid(c.quoteCodeId, "quote") : "";
        if (c.notes !== undefined) changes.notes = text(c.notes);
        if (c.themeIds !== undefined) changes.theme_ids = uuids(c.themeIds, "theme");
        if (c.codeIds !== undefined) changes.code_ids = uuids(c.codeIds, "code");
        ({ error } = await supabase.rpc("update_deck_slide", { p_slide_id: slideId, p_changes: changes }));
        break;
      }
      case "move":
        ({ error } = await supabase.rpc("move_deck_slide", { p_slide_id: await inDeck(uuid(body.slideId, "slide")), p_delta: body.delta === -1 ? -1 : 1 }));
        break;
      case "delete":
        ({ error } = await supabase.rpc("delete_deck_slide", { p_slide_id: await inDeck(uuid(body.slideId, "slide")) }));
        break;
      case "revert":
        ({ error } = await supabase.rpc("revert_last_deck_slide_edit", { p_slide_id: await inDeck(uuid(body.slideId, "slide")) }));
        break;
      case "dismiss": {
        const rejectionId = uuid(body.rejectionId, "proposal");
        const { count } = await supabase
          .from("product_item_rejection")
          .select("id", { count: "exact", head: true })
          .eq("id", rejectionId)
          .eq("product_id", productId);
        if (!count) throw new ApiError("That proposal isn't part of this deck.", 404);
        ({ error } = await supabase.rpc("dismiss_product_rejection", { p_rejection_id: rejectionId }));
        break;
      }
      case "title":
        ({ error } = await supabase.rpc("set_product_title", { p_product_id: productId, p_title: text(body.title, 300) ?? "" }));
        break;
      default:
        throw new ApiError("Unknown action.");
    }

    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't change the deck.", 403);
      if (error.code === "P0002") throw new ApiError("That no longer exists.", 404);
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "23514") throw new ApiError("A slide needs a title, and at most six bullets.");
      throw error;
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
