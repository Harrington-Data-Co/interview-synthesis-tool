import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** The workspace role. Harrington's own people have one; someone from
 *  outside (a client or a partner) has none and sees only their projects. */
export type SeatRole = "owner" | "editor" | "viewer";

/** A role on one project. */
export type ProjectRole = "owner" | "editor" | "viewer" | "client";

export type Seat = {
  user_id: string;
  name: string;
  initials: string;
  email: string;
  role: SeatRole | null;
  title: string | null;
  /** An editor somewhere: of the workspace or of any project. */
  canEditAny: boolean;
  /** Their role needs two-factor sign-in and this session hasn't done it:
   *  the database shows them nothing until it has (migration 20261001a). */
  mfaRequired: boolean;
};

/** The signed-in person's seat, or null if they have a Supabase account but no
 *  seat on this workspace. Those are different things: authentication says who
 *  you are, the seat says whether you belong here and what you may change.
 *  Accepts any open invitations first, so a first sign-in lands with a seat. */
export const currentSeat = cache(async (): Promise<Seat | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const read = () =>
    supabase
      .from("seat")
      .select("user_id,name,initials,email,role,title,deactivated_at")
      .eq("user_id", user.id)
      .maybeSingle();

  let { data } = await read();
  if (!data || data.deactivated_at) {
    const { data: accepted } = await supabase.rpc("accept_invitations");
    if (accepted) ({ data } = await read());
  }
  if (!data || data.deactivated_at) return null;

  const [{ data: canEditAny }, { data: mfaRequired }] = await Promise.all([
    supabase.rpc("can_edit"),
    // Absent before migration 20261001a; then nothing is required.
    supabase.rpc("mfa_required_now"),
  ]);
  return {
    user_id: data.user_id,
    name: data.name,
    initials: data.initials,
    email: data.email,
    role: data.role as SeatRole | null,
    title: data.title,
    canEditAny: !!canEditAny,
    mfaRequired: mfaRequired === true,
  };
});

/** Harrington's own people: they see the workspace-wide pages (Sources,
 *  People, Organizations, the template library). */
export function isStaff(seat: Seat | null): boolean {
  return !!seat?.role;
}

/** May change workspace-wide things (clients, the library, people). */
export function canEditWorkspace(seat: Seat | null): boolean {
  return seat?.role === "owner" || seat?.role === "editor";
}

/** May edit something somewhere. Where exactly is the database's call. */
export function canEdit(seat: Seat | null): boolean {
  return !!seat?.canEditAny;
}

export type ProjectAccess = {
  role: ProjectRole;
  /** Clients only: "deliverables" (the default) or "full" (read-only everything). */
  clientAccess: "deliverables" | "full" | null;
  /** Sees the working layer — transcripts, codes, notes — not just deliverables. */
  full: boolean;
  edit: boolean;
  /** Manages members and invitations. */
  manage: boolean;
};

/** What the signed-in person may do on one project; null if they can't see it. */
export const projectAccess = cache(async (projectId: string): Promise<ProjectAccess | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("project_access", { p_project_id: projectId });
  if (!data) return null;
  const a = data as { role: ProjectRole; client_access: "deliverables" | "full" | null; full: boolean; edit: boolean; manage: boolean };
  return {
    role: a.role,
    clientAccess: a.role === "client" ? (a.client_access ?? "deliverables") : null,
    full: a.full,
    edit: a.edit,
    manage: a.manage,
  };
});

/** Projects where the signed-in person is a client on deliverables-only
 *  access, for cards and lists that shouldn't offer them the working layer. */
export const deliverablesOnlyProjects = cache(async (): Promise<Set<string>> => {
  const seat = await currentSeat();
  if (!seat || seat.role === "owner") return new Set();
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_member")
    .select("project_id")
    .eq("user_id", seat.user_id)
    .eq("role", "client")
    .eq("client_access", "deliverables");
  return new Set((data ?? []).map((r) => r.project_id));
});
