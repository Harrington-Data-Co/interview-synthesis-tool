import { createAdminClient, createLinkSender } from "@/lib/supabase/admin";
import { withBase } from "@/lib/basePath";

/** Where links in invitation emails land. The deployed site's address when
 *  set (SITE_URL), else wherever this request came in. */
export function siteOrigin(request: Request): string {
  return (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export type Delivery = { emailed: boolean; note?: string };

/** Where every emailed link lands: /auth/confirm, then the page that sets a
 *  password. */
const landing = (origin: string) => `${origin}${withBase("/auth/confirm")}?next=${encodeURIComponent("/account/password")}`;

/** Email an invitation. A new address gets Supabase's invite email (which
 *  creates the account; the sign-up hook lets it through because the
 *  invitation exists). An address that already has an account gets a
 *  password-reset email instead. Either way the link lands on /auth/confirm,
 *  then on choosing a password, and the invitation is accepted on arrival.
 *  Failing to email isn't failing to invite: the invitation stands, and its
 *  link can be copied instead. */
export async function emailInvitation(email: string, name: string | null, origin: string): Promise<Delivery> {
  const admin = createAdminClient();
  if (!admin) return { emailed: false, note: "Email isn't set up here (no service role key). Copy the invite link instead." };
  const redirectTo = landing(origin);
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: name ? { name } : undefined });
  if (!error) return { emailed: true };
  if (alreadyRegistered(error)) {
    const { error: again } = await createLinkSender().auth.resetPasswordForEmail(email, { redirectTo });
    if (!again) return { emailed: true };
    return { emailed: false, note: `Couldn't email a link: ${again.message}` };
  }
  return { emailed: false, note: `Couldn't send the email: ${error.message}` };
}

/** A link to hand over yourself (chat, your own email), for when the email
 *  doesn't arrive: it sets up a new account, or sets a new password on an
 *  existing one. Making one replaces any link already emailed. */
export async function invitationLink(email: string, origin: string): Promise<string> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Invite links need SUPABASE_SERVICE_ROLE_KEY.");
  const redirectTo = landing(origin);
  let { data, error } = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (error && alreadyRegistered(error)) ({ data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } }));
  if (error || !data?.properties) throw new Error(error?.message ?? "Couldn't make a link.");
  const q = new URLSearchParams({ token_hash: data.properties.hashed_token, type: data.properties.verification_type, next: "/account/password" });
  return `${origin}${withBase("/auth/confirm")}?${q}`;
}

function alreadyRegistered(error: { message: string; status?: number; code?: string }): boolean {
  return error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message);
}
