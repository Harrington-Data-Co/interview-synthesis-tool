import { ApiError, dbError, errorResponse, requireSeat } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

/** Your own profile. Body: { name, initials?, title? }. The name goes to
 *  this tool's seat and to the shared Harrington Tools account (Supabase
 *  Auth's user metadata), which other tools read. */
export async function PATCH(request: Request) {
  try {
    await requireSeat();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const initials = typeof body.initials === "string" ? body.initials.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    if (!name) throw new ApiError("Your name can't be empty.");

    const supabase = await createClient();
    const { error } = await supabase.rpc("update_my_profile", { p_name: name, p_initials: initials || null, p_title: title || null });
    if (error) dbError(error);
    // The shared account; a failure here doesn't undo the seat.
    await supabase.auth.updateUser({ data: { full_name: name } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
