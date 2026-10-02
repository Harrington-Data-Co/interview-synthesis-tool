import { ApiError, dbError, errorResponse, requireSeat } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

/** Workspace settings (owners). Body: { invitationDays }. The two-factor
 *  requirement is deliberately not settable here until the enrollment
 *  screens exist: turning it on now would lock those people out. */
export async function PATCH(request: Request) {
  try {
    await requireSeat();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const days = Number(body.invitationDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new ApiError("Invitations can last 1 to 90 days.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_workspace_settings", { p_invitation_days: days, p_mfa_required_for: null });
    if (error) dbError(error);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
