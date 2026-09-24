/** Harrington Tools is internal for now. Sign-in is restricted to this domain,
 *  and beyond that to addresses that have a seat row. */
export const ALLOWED_EMAIL_DOMAIN = "harringtondata.com";

export function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

/** Present so the UI can say "not configured yet" instead of throwing a wall of
 *  Supabase errors at someone who has just cloned the repo. */
export const supabaseConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
