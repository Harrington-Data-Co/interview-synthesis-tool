import Link from "next/link";
import { ProjectCard } from "@/components/project/ProjectCard";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { clientLabel, loadDirectory } from "@/lib/directory";
import { loadTranscripts } from "@/lib/library";
import { loadProgress } from "@/lib/progress";
import { canEditWorkspace, currentSeat, deliverablesOnlyProjects } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";
import { clientPath } from "@/lib/urls";

/** Interview Synthesis's home: every project, by client, with how far each
 *  step has got, and a pointer to anything waiting on Sources. */
export default async function HomePage() {
  const supabase = await createClient();
  const [directory, seat, { rows, error }] = await Promise.all([loadDirectory(supabase), currentSeat(), loadTranscripts(supabase)]);
  // New projects and unassigned uploads are workspace things.
  const editor = canEditWorkspace(seat);
  const clientOnly = await deliverablesOnlyProjects();
  const progress = await loadProgress(
    supabase,
    directory.projects.map((p) => p.id),
    rows,
  );
  const unassigned = rows.filter((t) => !t.project_id).length;

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">Projects</span>
          <h2 style={{ fontSize: 20 }}>Where every project stands</h2>
          <p className="meta">Each step of the process, Interviews → Themes → Memo, and which outputs exist.</p>
        </div>
        {editor && (
          <div style={{ marginLeft: "auto" }}>
            <SourcesActions directory={directory} />
          </div>
        )}
      </div>

      {unassigned > 0 && (
        <Link href="/sources" className="panel" style={{ padding: "var(--space-3) var(--space-4)", textDecoration: "none", color: "inherit", display: "flex", gap: 8, alignItems: "center" }}>
          <span className="tag tag-accent">{unassigned}</span>
          <span>
            transcript{unassigned === 1 ? "" : "s"} waiting in Unassigned. Place {unassigned === 1 ? "it" : "them"} in a project on Sources →
          </span>
        </Link>
      )}

      {error && (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">
            Could not read the library: {error}. Have the files in <code>supabase/migrations</code> been applied?
          </p>
        </div>
      )}

      {!directory.clients.length && (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta" style={{ margin: 0 }}>
            {seat?.role ? "No clients yet. Start one with New project." : "You haven\u2019t been added to a project yet. Ask whoever invited you."}
          </p>
        </div>
      )}
      {directory.clients.map((c) => {
        const projects = directory.projects.filter((p) => p.clientId === c.id);
        // Projects are by membership: a client with none of yours is only
        // worth listing to an owner, who can start one.
        if (!projects.length && seat?.role !== "owner") return null;
        return (
          <section key={c.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Link href={clientPath(c.slug)} className="kicker" style={{ alignSelf: "flex-start" }}>
              {clientLabel(c)}
            </Link>
            {!projects.length ? (
              <p className="meta" style={{ margin: 0 }}>No projects yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "var(--space-3)" }}>
                {projects.map((p) => (
                  <ProjectCard key={p.id} path={p.path} name={p.name} progress={progress.get(p.id)!} deliverablesOnly={clientOnly.has(p.id)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
