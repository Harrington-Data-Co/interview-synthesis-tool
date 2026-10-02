import { redirect } from "next/navigation";
import { WorkspaceTabs } from "@/components/workspace/WorkspaceTabs";
import { currentSeat } from "@/lib/seat";

/** The workspace, for its owners: who's in it, what's happened, the
 *  settings they change, and the checklist for getting a deployment ready. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const seat = await currentSeat();
  if (seat?.role !== "owner") redirect("/");
  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1100, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h2 style={{ fontSize: 26, margin: 0 }}>Workspace</h2>
        <WorkspaceTabs />
      </div>
      {children}
    </div>
  );
}
