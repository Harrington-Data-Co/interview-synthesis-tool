import { ApiError, dbError, errorResponse, requireSeat } from "@/lib/api";
import { emailInvitation, siteOrigin } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Send an open invitation again; its 14 days start over. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSeat();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown invitation.", 404);
    const supabase = await createClient();
    const { data: email, error } = await supabase.rpc("renew_invitation", { p_invitation_id: id });
    if (error) dbError(error);
    const { data: inv } = await supabase.from("invitation").select("name").eq("id", id).maybeSingle();
    return Response.json(await emailInvitation(email as string, inv?.name ?? null, siteOrigin(request)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Withdraw an open invitation. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSeat();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown invitation.", 404);
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: id });
    if (error) dbError(error);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
