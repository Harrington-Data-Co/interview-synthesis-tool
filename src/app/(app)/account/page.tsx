import { redirect } from "next/navigation";
import { AccountView } from "@/components/account/AccountView";
import { currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Your account: who you are (shared across Harrington Tools), how you sign
 *  in, and what you can get at in this tool. */
export default async function AccountPage() {
  const seat = await currentSeat();
  if (!seat) redirect("/");
  const supabase = await createClient();
  const [{ data: memberships }, { data: projects }, { data: clients }] = await Promise.all([
    supabase.from("project_member").select("project_id,role,client_access").eq("user_id", seat.user_id),
    supabase.from("project").select("id,name,client_id"),
    supabase.from("client").select("id,name"),
  ]);
  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const access = (memberships ?? [])
    .map((m) => {
      const p = projectById.get(m.project_id);
      return {
        project: p?.name ?? "A project",
        client: p ? (clientName.get(p.client_id) ?? null) : null,
        role: m.role as string,
        clientAccess: m.client_access as string,
      };
    })
    .sort((a, b) => (a.client ?? "").localeCompare(b.client ?? "") || a.project.localeCompare(b.project));

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 860, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">Harrington Tools</span>
        <h2 style={{ fontSize: 26, margin: 0 }}>Your account</h2>
        <p className="meta">Your name and sign-in are shared by every Harrington tool; what you can see is set in each.</p>
      </div>
      <AccountView
        name={seat.name}
        initials={seat.initials}
        title={seat.title}
        email={seat.email}
        workspaceRole={seat.role}
        allProjects={seat.role === "owner"}
        access={access}
      />
    </div>
  );
}
