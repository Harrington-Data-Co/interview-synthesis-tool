import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create an organization, optionally under a parent. */
export async function POST(request: Request) {
  try {
    const seat = await requireEditor();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
    if (!name || name.length > 200) throw new ApiError("Give the organization a name.");
    if (parentId && !UUID.test(parentId)) throw new ApiError("Unknown parent organization.");

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization")
      .insert({ name, parent_id: parentId, created_by: seat.user_id })
      .select("id,name,parent_id")
      .single();
    if (error) {
      if (error.code === "23505") throw new ApiError(`“${name}” already exists there.`, 409);
      throw error;
    }
    return Response.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}
