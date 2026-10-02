import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/when";

/** Who invited, added, changed or removed whom (migration 20261001a):
 *  everything for a workspace owner, one project's for its owners. */
export async function AccessLog({ projectId, limit = 60, heading = true }: { projectId?: string; limit?: number; heading?: boolean }) {
  const supabase = await createClient();
  let query = supabase.from("access_event").select("id,at,actor,verb,subject_user,subject_email,project_id,detail").order("at", { ascending: false }).limit(limit);
  if (projectId) query = query.eq("project_id", projectId);
  const [{ data: events, error }, { data: seats }, { data: projects }] = await Promise.all([
    query,
    supabase.from("seat").select("user_id,name"),
    projectId ? Promise.resolve({ data: [] as { id: string; name: string }[] }) : supabase.from("project").select("id,name"),
  ]);
  if (error) return null; // before migration 20261001a
  const who = new Map((seats ?? []).map((s) => [s.user_id, s.name]));
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 860 }}>
      {heading && <span className="kicker">Activity</span>}
      {!events?.length ? (
        <p className="meta">Nothing yet.</p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {events.map((e) => {
            const actor = e.actor ? (who.get(e.actor) ?? "Someone") : "The system";
            const subject = e.subject_user ? (who.get(e.subject_user) ?? e.subject_email ?? "someone") : e.subject_email;
            const selfAct = e.verb === "accepted an invitation" || e.verb === "left" || (e.verb === "joined the workspace" && e.actor === e.subject_user);
            return (
              <li key={e.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "var(--space-3)", fontSize: 13 }}>
                <span className="meta mono" style={{ fontSize: 11.5 }}>
                  {formatDateTime(e.at)}
                </span>
                <span>
                  <strong>{selfAct ? subject : actor}</strong> {e.verb}
                  {!selfAct && subject ? <> <strong>{subject}</strong></> : null}
                  {e.detail ? <span className="meta"> · {e.detail}</span> : null}
                  {!projectId && e.project_id ? <span className="meta"> · {projectName.get(e.project_id) ?? "a project"}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
