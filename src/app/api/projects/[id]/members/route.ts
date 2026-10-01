import { ApiError, dbError, errorResponse, requireSeat } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["owner", "editor", "viewer", "client"];

/** Change someone's role on the project. Body: { userId, role, clientAccess? }. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSeat();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId : "";
    const role = typeof body.role === "string" ? body.role : "";
    if (!UUID.test(id) || !UUID.test(userId)) throw new ApiError("Unknown member.", 404);
    if (!ROLES.includes(role)) throw new ApiError("Unknown role.");
    const clientAccess = body.clientAccess === "full" || body.clientAccess === "deliverables" ? body.clientAccess : null;
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_project_member", {
      p_project_id: id,
      p_user_id: userId,
      p_role: role,
      p_client_access: clientAccess,
    });
    if (error) dbError(error);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Take someone off the project (or leave it): ?userId=. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSeat();
    const { id } = await ctx.params;
    const userId = new URL(request.url).searchParams.get("userId") ?? "";
    if (!UUID.test(id) || !UUID.test(userId)) throw new ApiError("Unknown member.", 404);
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_project_member", { p_project_id: id, p_user_id: userId });
    if (error) dbError(error);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
