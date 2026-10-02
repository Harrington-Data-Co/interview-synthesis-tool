import { redirect } from "next/navigation";
import { MembersPanel, type InviteRow, type MemberRow } from "@/components/members/MembersPanel";
import { AccessLog } from "@/components/members/AccessLog";
import { currentSeat } from "@/lib/seat";
import { sinceText } from "@/lib/when";
import { createClient } from "@/lib/supabase/server";

const ORDER = ["owner", "editor", "viewer", ""];

/** The workspace's people, for its owners: Harrington's own (with a
 *  workspace role) and everyone invited from outside, with the projects
 *  each is on; every open invitation; and inviting Harrington colleagues.
 *  People from outside are invited from a project's Members tab. */
export default async function MembersPage() {
  const seat = await currentSeat();
  if (seat?.role !== "owner") redirect("/");
  const supabase = await createClient();
  const [{ data: seats, error }, { data: memberships }, { data: projects }, { data: invites }, { data: signIns }] = await Promise.all([
    supabase.from("seat").select("user_id,name,email,initials,role").is("deactivated_at", null).order("name"),
    supabase.from("project_member").select("user_id,project_id,role"),
    supabase.from("project").select("id,name"),
    supabase
      .from("invitation")
      .select("id,email,name,workspace_role,project_id,project_role,client_access,expires_at,sent_count")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("invited_at", { ascending: false }),
    supabase.rpc("member_sign_ins"),
  ]);
  const lastSignIn = new Map(((signIns ?? []) as { user_id: string; last_sign_in_at: string | null }[]).map((r) => [r.user_id, r.last_sign_in_at]));

  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const onProjects = new Map<string, string[]>();
  for (const m of memberships ?? []) {
    const list = onProjects.get(m.user_id) ?? [];
    list.push(`${projectName.get(m.project_id) ?? "a project"} (${m.role})`);
    onProjects.set(m.user_id, list);
  }

  const members: MemberRow[] = (seats ?? [])
    .map((s) => ({
      userId: s.user_id,
      name: s.name,
      email: s.email,
      initials: s.initials,
      role: s.role,
      projects: (onProjects.get(s.user_id) ?? []).sort(),
      you: s.user_id === seat.user_id,
      lastSignIn: signIns ? sinceText(lastSignIn.get(s.user_id) ?? null) : undefined,
    }))
    .sort((a, b) => ORDER.indexOf(a.role ?? "") - ORDER.indexOf(b.role ?? "") || a.name.localeCompare(b.name));

  const inviteRows: InviteRow[] = (invites ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    name: i.name,
    gives: [
      i.workspace_role && `workspace ${i.workspace_role}`,
      i.project_id && `${i.project_role} on ${projectName.get(i.project_id) ?? "a project"}${i.project_role === "client" ? (i.client_access === "full" ? " (everything)" : " (deliverables)") : ""}`,
    ]
      .filter(Boolean)
      .join(", "),
    daysLeft: daysUntil(i.expires_at),
    sentCount: i.sent_count,
    canSend: true,
  }));

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">Workspace</span>
        <h2 style={{ fontSize: 26, margin: 0 }}>Members</h2>
        <p className="meta" style={{ maxWidth: 720 }}>
          Only people invited here can sign in, whatever their email address. Everyone sees just the projects they&apos;re on;
          workspace owners see them all. A workspace role (owner, editor, viewer) is for Harrington&apos;s own people and opens
          People, Organizations, the template library and Sources. Removing someone takes them off every project; what they
          made stays, under their name.
        </p>
      </div>
      {error ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">Could not read the members: {error.message}. Has migration 20260930g been applied?</p>
        </div>
      ) : (
        <>
          <MembersPanel scope={{ kind: "workspace" }} members={members} invites={inviteRows} manage />
          <AccessLog />
        </>
      )}
    </div>
  );
}

function daysUntil(when: string): number {
  return Math.ceil((new Date(when).getTime() - Date.now()) / 86_400_000);
}
