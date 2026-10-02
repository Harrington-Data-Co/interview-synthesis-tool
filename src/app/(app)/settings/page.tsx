import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { InvitationDays } from "@/components/account/InvitationDays";
import { BASE_PATH } from "@/lib/basePath";
import { googleConfigured } from "@/lib/connectors/google";
import { supabaseConfigured } from "@/lib/config";
import { currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

type Check = { label: string; ok: boolean | null; detail: React.ReactNode };

/** Workspace settings, for owners: how long invitations last, two-factor
 *  sign-in (not yet switchable), and a check of how this server is set up —
 *  what to look at before and after deploying to tools.harringtondata.com. */
export default async function SettingsPage() {
  const seat = await currentSeat();
  if (seat?.role !== "owner") redirect("/");
  const supabase = await createClient();
  const { data: setting, error } = await supabase.from("workspace_setting").select("invitation_days,mfa_required_for,updated_at").maybeSingle();

  const h = await headers();
  const requestOrigin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const site = (process.env.SITE_URL || requestOrigin).replace(/\/$/, "");
  const app = `${site}${BASE_PATH}`;

  const checks: Check[] = [
    { label: "Supabase project", ok: supabaseConfigured, detail: supabaseConfigured ? process.env.NEXT_PUBLIC_SUPABASE_URL : "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY" },
    { label: "Database up to date", ok: !error, detail: error ? "Migration 20261001a_settings_and_access hasn't been applied." : "Through migration 20261001a." },
    {
      label: "Invitation emails and links",
      ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      detail: process.env.SUPABASE_SERVICE_ROLE_KEY ? "Service role key set." : "SUPABASE_SERVICE_ROLE_KEY is missing: invitations can be made but not emailed or linked.",
    },
    {
      label: "Site address",
      ok: process.env.SITE_URL ? true : null,
      detail: process.env.SITE_URL ? process.env.SITE_URL : `SITE_URL isn't set; links in emails use this request's address (${requestOrigin}). Set it to https://tools.harringtondata.com when deployed.`,
    },
    { label: "Path on the site", ok: null, detail: BASE_PATH ? BASE_PATH : "At the root (NEXT_PUBLIC_BASE_PATH empty). In production: /interview-synthesis." },
    { label: "Claude", ok: Boolean(process.env.ANTHROPIC_API_KEY), detail: process.env.ANTHROPIC_API_KEY ? "Key set." : "ANTHROPIC_API_KEY is missing: coding, notes and deliverables can't run." },
    {
      label: "Google Drive",
      ok: googleConfigured(),
      detail: googleConfigured() ? "Connected app configured." : "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and CONNECTOR_TOKEN_KEY.",
    },
  ];

  const toRegister: [string, string[]][] = [
    ["Supabase → Authentication → URL Configuration: Site URL", [app]],
    ["…and Redirect URLs", [`${app}/auth/confirm`, `${app}/auth/callback`]],
    ["Google Cloud → the OAuth client → Authorized redirect URIs", [`${app}/api/connectors/google/callback`]],
  ];

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 960, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">Workspace</span>
        <h2 style={{ fontSize: 26, margin: 0 }}>Settings</h2>
      </div>

      <section className="panel" style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span className="kicker">Invitations</span>
        {setting ? <InvitationDays days={setting.invitation_days} /> : <p className="meta">Apply migration 20261001a to change this.</p>}
      </section>

      <section className="panel" style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="kicker">Two-factor sign-in</span>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          Required for: <strong>{setting?.mfa_required_for?.length ? setting.mfa_required_for.join(", ") : "nobody"}</strong>.
        </p>
        <p className="meta" style={{ margin: 0 }}>
          The database can already require it by role (owners, editors, project owners, people from outside, or everyone) and
          hides everything from a session that hasn&apos;t done it. What&apos;s still to build is the screen where people set up
          an authenticator app; until then it stays off, since switching it on would lock those people out.
        </p>
      </section>

      <section className="panel" style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span className="kicker">This server</span>
        <table className="table">
          <tbody>
            {checks.map((c) => (
              <tr key={c.label}>
                <td style={{ width: 28 }}>
                  <span
                    aria-label={c.ok === true ? "Ready" : c.ok === false ? "Needs attention" : "For information"}
                    className={`tag ${c.ok === true ? "tag-accent" : c.ok === false ? "tag-outline" : "tag-neutral"}`}
                  >
                    {c.ok === true ? "✓" : c.ok === false ? "!" : "i"}
                  </span>
                </td>
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{c.label}</td>
                <td className="meta" style={{ wordBreak: "break-word" }}>
                  {c.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span className="kicker">Addresses to register for this server</span>
        <p className="meta" style={{ margin: 0 }}>
          Sign-in and Google Drive only send people back to addresses they&apos;ve been told about. For this server
          ({app}), these must be listed:
        </p>
        {toRegister.map(([where, urls]) => (
          <div key={where} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{where}</span>
            {urls.map((u) => (
              <code key={u} style={{ fontSize: 12.5, wordBreak: "break-all" }}>
                {u}
              </code>
            ))}
          </div>
        ))}
        <p className="meta" style={{ margin: 0 }}>
          Also in Supabase, once: the sign-up hook (Authentication → Hooks → Before User Created →
          hook_require_invitation), custom SMTP, and the two email templates in the README.
        </p>
      </section>
    </div>
  );
}
