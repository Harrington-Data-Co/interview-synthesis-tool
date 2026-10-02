import { redirect } from "next/navigation";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { currentSeat } from "@/lib/seat";

/** Settings, for workspace owners (from the account menu): who's in the
 *  workspace, how the tool is being used and what it costs, the access log,
 *  and the checklist for getting a deployment ready. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const seat = await currentSeat();
  if (seat?.role !== "owner") redirect("/");
  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1100, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h2 style={{ fontSize: 26, margin: 0 }}>Settings</h2>
        <SettingsTabs />
      </div>
      {children}
    </div>
  );
}
