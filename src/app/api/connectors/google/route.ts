import { errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

/** Disconnect your Google account. Google keeps the grant until it's
 *  removed at myaccount.google.com; the app forgets its token. */
export async function DELETE() {
  try {
    await requireEditor();
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_connector_account", { p_provider: "google" });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
