import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown, what = "person") => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};

/** People: edit, merge or delete. Body: { action: "update", personId,
 *  changes: { name?, organization_id?, title? } } | { action: "merge", keepId,
 *  mergeIds } | { action: "delete", personId }. The database functions check
 *  the rules and log each change. */
export async function POST(request: Request) {
  try {
    await requireEditor();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();
    let result;
    if (body.action === "update") {
      const raw = (body.changes ?? {}) as Record<string, unknown>;
      const changes: Record<string, string | null> = {};
      for (const k of ["name", "organization_id", "title"] as const) {
        if (k in raw) changes[k] = typeof raw[k] === "string" ? (raw[k] as string).slice(0, 200) : null;
      }
      if (changes.organization_id) id(changes.organization_id, "organization");
      result = await supabase.rpc("update_person", { p_person_id: id(body.personId), p_changes: changes });
    } else if (body.action === "merge") {
      const mergeIds = Array.isArray(body.mergeIds) ? body.mergeIds.map((m) => id(m)) : [];
      if (!mergeIds.length) throw new ApiError("Pick the people to merge in.");
      result = await supabase.rpc("merge_people", { p_keep_id: id(body.keepId), p_merge_ids: mergeIds });
    } else if (body.action === "delete") {
      result = await supabase.rpc("delete_person", { p_person_id: id(body.personId) });
    } else {
      throw new ApiError("Unknown action.");
    }
    const { data, error } = result;
    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't make changes here.", 403);
      if (error.code === "P0001" || error.code === "P0002") throw new ApiError(error.message);
      if (error.code === "23503") throw new ApiError("That organization no longer exists.");
      throw error;
    }
    return Response.json({ result: data });
  } catch (e) {
    return errorResponse(e);
  }
}
