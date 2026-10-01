/** Who may sign in is decided by invitation (migration 20260930g and the
 *  hook_require_invitation sign-up hook), not by email domain. */

/** The Harrington Tools hub, where the header's "Harrington Tools" links.
 *  Not built yet (2026-09-30): until it is, the brand isn't a link. */
export const TOOLS_HOME_URL: string | null = null;

/** Present so the UI can say "not configured yet" instead of throwing a wall of
 *  Supabase errors at someone who has just cloned the repo. */
export const supabaseConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
