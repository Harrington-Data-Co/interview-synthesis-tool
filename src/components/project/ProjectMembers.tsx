import { MembersPanel, PROJECT_ROLES, type InviteRow, type MemberRow } from "@/components/members/MembersPanel";
import { currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

type SeatRef = { name: string; email: string; initials: string };

/** A project's Members tab: who's on it as what, and (for its owners) the
 *  invitations still open and a form to invite more. Workspace owners see
 *  every project without being on it, so they aren't listed unless they are. */
export async function ProjectMembers({ projectId, projectName, manage }: { projectId: string; projectName: string; manage: boolean }) {
  const supabase = await createClient();
  const [seat, { data: rows, error }, { data: invites }] = await Promise.all([
    currentSeat(),
    supabase
      .from("project_member")
      .select("user_id,role,client_access,seat:seat!project_member_user_id_fkey(name,email,initials)")
      .eq("project_id", projectId),
    manage
      ? supabase
          .from("invitation")
          .select("id,email,name,project_role,client_access,workspace_role,expires_at,sent_count")
          .eq("project_id", projectId)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .order("invited_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const order = PROJECT_ROLES.map(([k]) => k as string);
  const members: MemberRow[] = (rows ?? [])
    .map((r) => {
      const s = r.seat as unknown as SeatRef | null;
      return {
        userId: r.user_id,
        name: s?.name ?? "Someone",
        email: s?.email ?? "",
        initials: s?.initials ?? "?",
        role: r.role,
        clientAccess: r.client_access as "deliverables" | "full",
        you: r.user_id === seat?.user_id,
      };
    })
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));

  const label = (role: string) => PROJECT_ROLES.find(([k]) => k === role)?.[1] ?? role;
  const inviteRows: InviteRow[] = (invites ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    name: i.name,
    gives:
      label(i.project_role) +
      (i.project_role === "client" ? (i.client_access === "full" ? ", sees everything" : ", sees deliverables") : "") +
      (i.workspace_role ? ` (and workspace ${i.workspace_role})` : ""),
    daysLeft: daysUntil(i.expires_at),
    sentCount: i.sent_count,
    canSend: !i.workspace_role || seat?.role === "owner",
  }));

  if (error) {
    return (
      <div className="panel" style={{ padding: "var(--space-4)" }}>
        <p className="meta">Could not read the members: {error.message}. Has migration 20260930g been applied?</p>
      </div>
    );
  }
  return <MembersPanel scope={{ kind: "project", projectId, projectName }} members={members} invites={inviteRows} manage={manage} />;
}

function daysUntil(when: string): number {
  return Math.ceil((new Date(when).getTime() - Date.now()) / 86_400_000);
}
