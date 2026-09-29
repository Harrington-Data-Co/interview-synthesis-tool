import { ApiError, errorResponse } from "@/lib/api";
import { sha256Hex } from "@/lib/ingest/source";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Re-hash the stored original and compare it with the checksum taken at
 *  ingest. A match means the file is still the record; a mismatch means it
 *  isn't, and says so loudly. Editors' checks are logged to activity. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const seat = await currentSeat();
    if (!seat) throw new ApiError("Sign in with a seat on this workspace.", 401);
    const { id } = await ctx.params;

    const supabase = await createClient();
    const { data: t } = await supabase
      .from("transcript")
      .select("title,sha256,storage_path,project_id")
      .eq("id", id)
      .maybeSingle();
    if (!t) throw new ApiError("Unknown transcript.", 404);
    if (!t.storage_path) throw new ApiError("No stored original for this transcript.", 404);

    const { data: blob, error } = await supabase.storage.from("transcripts").download(t.storage_path);
    if (error || !blob) throw new ApiError("The stored original couldn't be read.", 502);

    const actual = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
    const match = actual === t.sha256;

    if (canEdit(seat)) {
      await supabase.from("activity").insert({
        project_id: t.project_id,
        actor: seat.user_id,
        verb: match ? "verified checksum" : "checksum MISMATCH",
        object: t.title,
      });
    }
    return Response.json({ match, expected: t.sha256, actual, checkedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
