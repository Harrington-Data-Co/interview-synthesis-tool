import { InvitationDays } from "@/components/account/InvitationDays";
import { createClient } from "@/lib/supabase/server";

/** What a workspace owner changes. Two-factor sign-in joins this once its
 *  setup screens exist (the database side is in migration 20261001a). */
export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: setting } = await supabase.from("workspace_setting").select("invitation_days").maybeSingle();
  return (
    <section className="panel" style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span className="kicker">Invitations</span>
      {setting ? (
        <InvitationDays days={setting.invitation_days} />
      ) : (
        <p className="meta" style={{ margin: 0 }}>
          Apply migration 20261001a_settings_and_access to change this.
        </p>
      )}
    </section>
  );
}
