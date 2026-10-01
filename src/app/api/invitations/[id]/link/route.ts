import { ApiError, dbError, errorResponse, requireSeat } from "@/lib/api";
import { invitationLink, siteOrigin } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A sign-in link for an open invitation, to pass on by hand. Renewing it
 *  first checks the caller may send this invitation, and restarts its 14
 *  days to match the link. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSeat();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown invitation.", 404);
    const supabase = await createClient();
    const { data: email, error } = await supabase.rpc("renew_invitation", { p_invitation_id: id });
    if (error) dbError(error);
    try {
      return Response.json({ link: await invitationLink(email as string, siteOrigin(request)) });
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : "Couldn't make a link.", 500);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
