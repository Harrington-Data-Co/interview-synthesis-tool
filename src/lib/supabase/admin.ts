import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

/** The service-role client, for the one thing the signed-in person's own
 *  client can't do: create and email Supabase Auth accounts. Server only —
 *  the key bypasses row-level security, so nothing else should use it, and
 *  who may invite whom is decided first by invite_member() as the caller.
 *  Null when the key isn't configured. */
export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) return null;
  return createSupabaseClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A plain anon client with no session, for sending a sign-in link to
 *  someone else: its link carries the session in the URL fragment, which
 *  /auth/confirm picks up, rather than a code tied to this server's cookies. */
export function createLinkSender(): SupabaseClient {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });
}
