import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = (v: unknown) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError("Unknown organization.");
  return v;
};

/** Change organizations. Body: { action: "update", orgId, changes: { name?,
 *  parent_id? } } | { action: "merge", keepId, mergeIds } | { action:
 *  "delete", orgId }. The database functions check the rules and log each
 *  change. */
async function manage(body: Record<string, unknown>): Promise<Response> {
  const supabase = await createClient();
  let result;
  if (body.action === "update") {
    const raw = (body.changes ?? {}) as Record<string, unknown>;
    const changes: Record<string, string | null> = {};
    if ("name" in raw) changes.name = typeof raw.name === "string" ? raw.name.slice(0, 200) : null;
    if ("parent_id" in raw) changes.parent_id = raw.parent_id ? id(raw.parent_id) : null;
    result = await supabase.rpc("update_organization", { p_org_id: id(body.orgId), p_changes: changes });
  } else if (body.action === "merge") {
    const mergeIds = Array.isArray(body.mergeIds) ? body.mergeIds.map(id) : [];
    if (!mergeIds.length) throw new ApiError("Pick the organizations to merge in.");
    result = await supabase.rpc("merge_organizations", { p_keep_id: id(body.keepId), p_merge_ids: mergeIds });
  } else if (body.action === "delete") {
    result = await supabase.rpc("delete_organization", { p_org_id: id(body.orgId) });
  } else {
    throw new ApiError("Unknown action.");
  }
  const { data, error } = result;
  if (error) {
    if (error.code === "42501") throw new ApiError("Viewers can't make changes here.", 403);
    if (error.code === "P0001" || error.code === "P0002") throw new ApiError(error.message);
    throw error;
  }
  return Response.json({ result: data });
}

/** Create an organization, optionally under a parent; or, with an action,
 *  rename, move, merge or delete one. */
export async function POST(request: Request) {
  try {
    const seat = await requireEditor();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action) return await manage(body);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
    if (!name || name.length > 200) throw new ApiError("Give the organization a name.");
    if (parentId && !UUID.test(parentId)) throw new ApiError("Unknown parent organization.");

    const supabase = await createClient();
    const { data, error } = await supabase.from("organization").insert({ name, parent_id: parentId, created_by: seat.user_id }).select("id,name,parent_id").single();
    if (error) {
      if (error.code === "23505") throw new ApiError(`“${name}” already exists there.`, 409);
      throw error;
    }
    return Response.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}
