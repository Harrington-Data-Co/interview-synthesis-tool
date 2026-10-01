import { ApiError, dbError, errorResponse, requireSeat } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["owner", "editor", "viewer"];

/** Set someone's workspace role (workspace owners only). Body: { role },
 *  where null means none: someone from outside, who sees only their projects. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSeat();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown person.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const role = body.role === null || body.role === "" ? null : typeof body.role === "string" ? body.role : undefined;
    if (role === undefined || (role !== null && !ROLES.includes(role))) throw new ApiError("Unknown role.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_workspace_role", { p_user_id: id, p_role: role });
    if (error) dbError(error);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Remove someone from the workspace: every project, and any open
 *  invitations. Their seat stays as the author of what they made. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSeat();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown person.", 404);
    const supabase = await createClient();
    const { error } = await supabase.rpc("deactivate_seat", { p_user_id: id });
    if (error) dbError(error);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
