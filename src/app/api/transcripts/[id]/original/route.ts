import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** The original upload, via a signed URL that lives for a minute. The bucket
 *  is private; a link on the page would otherwise expire while it sat open. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await currentSeat())) throw new ApiError("Sign in with a seat on this workspace.", 401);
    const { id } = await ctx.params;

    const supabase = await createClient();
    const { data: t } = await supabase
      .from("transcript")
      .select("storage_path,original_name")
      .eq("id", id)
      .maybeSingle();
    if (!t?.storage_path) throw new ApiError("No stored original for this transcript.", 404);

    const { data, error } = await supabase.storage
      .from("transcripts")
      .createSignedUrl(t.storage_path, 60, { download: t.original_name ?? true });
    if (error) throw error;
    return NextResponse.redirect(data.signedUrl);
  } catch (e) {
    return errorResponse(e);
  }
}
