import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { NODE_KINDS } from "@/lib/arch/prompt";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const text = (v: unknown, max = 1000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const KINDS = { node: "system", flow: "flow", gap: "gap" } as const;

/** People's changes to one architecture map, each through a database
 *  function that checks and logs it.
 *
 *  Body: { action, ... }
 *    update  { changes: { title?, scope? } }
 *    delete  {}
 *    save    { kind: "node" | "flow" | "gap", itemId?, fields, rejectionId? } → { id }
 *            node {name, kind, official, note}, flow {fromNode, toNode, label,
 *            manual, note}, gap {title, note}; always codeIds[]
 *    remove  { kind, itemId }
 *    dismiss { rejectionId } */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id: mapId } = await ctx.params;
    if (!UUID.test(mapId)) throw new ApiError("Unknown map.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();
    const { data: map } = await supabase.from("arch_map").select("id,project_id").eq("id", mapId).maybeSingle();
    if (!map) throw new ApiError("Unknown map.", 404);

    let result: unknown = null;
    let error: { code?: string; message: string } | null = null;
    const kindOf = (v: unknown) => {
      if (v !== "node" && v !== "flow" && v !== "gap") throw new ApiError("Unknown kind of item.");
      return v;
    };
    switch (body.action) {
      case "update": {
        const c = (body.changes ?? {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        if (c.title !== undefined) changes.title = text(c.title, 300);
        if (c.scope !== undefined) changes.scope = text(c.scope);
        ({ error } = await supabase.rpc("update_arch_map", { p_map_id: mapId, p_changes: changes }));
        break;
      }
      case "delete":
        ({ error } = await supabase.rpc("delete_arch_map", { p_map_id: mapId }));
        break;
      case "save": {
        const kind = kindOf(body.kind);
        const f = (body.fields ?? {}) as Record<string, unknown>;
        const fields: Record<string, unknown> = { code_ids: Array.isArray(f.codeIds) ? f.codeIds.map((x) => uuid(x, "code")) : [] };
        if (kind === "node") {
          fields.name = text(f.name, 200);
          if (typeof f.kind !== "string" || !(NODE_KINDS as readonly string[]).includes(f.kind)) throw new ApiError("Unknown kind of system.");
          fields.kind = f.kind;
          fields.official = f.official !== false;
          fields.note = text(f.note) ?? "";
        } else if (kind === "flow") {
          fields.from_node = uuid(f.fromNode, "system");
          fields.to_node = uuid(f.toNode, "system");
          fields.label = text(f.label, 300);
          fields.manual = f.manual !== false;
          fields.note = text(f.note) ?? "";
        } else {
          fields.title = text(f.title, 300);
          fields.note = text(f.note) ?? "";
        }
        ({ data: result, error } = await supabase.rpc("save_arch_item", { p_map_id: mapId, p_kind: kind, p_id: body.itemId ? uuid(body.itemId, KINDS[kind]) : null, p_fields: fields }));
        if (!error && body.rejectionId) await supabase.rpc("dismiss_arch_rejection", { p_rejection_id: uuid(body.rejectionId, "proposal") });
        break;
      }
      case "remove": {
        const kind = kindOf(body.kind);
        ({ error } = await supabase.rpc("delete_arch_item", { p_map_id: mapId, p_kind: kind, p_id: uuid(body.itemId, KINDS[kind]) }));
        break;
      }
      case "dismiss": {
        const rejectionId = uuid(body.rejectionId, "proposal");
        const { count } = await supabase.from("arch_rejection").select("id", { count: "exact", head: true }).eq("id", rejectionId).eq("project_id", map.project_id);
        if (!count) throw new ApiError("That proposal isn't part of this project.", 404);
        ({ error } = await supabase.rpc("dismiss_arch_rejection", { p_rejection_id: rejectionId }));
        break;
      }
      default:
        throw new ApiError("Unknown action.");
    }
    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't change architecture maps.", 403);
      if (error.code === "P0002") throw new ApiError("That no longer exists.", 404);
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "23505") throw new ApiError("A system with that name is already on this map.", 409);
      if (error.code === "23514") throw new ApiError("That needs a name or title.");
      throw error;
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
