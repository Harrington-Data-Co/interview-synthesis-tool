import { notFound } from "next/navigation";
import { ProjectCard } from "@/components/project/ProjectCard";
import { ClientCode } from "@/components/sources/ClientCode";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { loadDirectory } from "@/lib/directory";
import { loadTranscripts } from "@/lib/library";
import { loadProgress } from "@/lib/progress";
import { canEditWorkspace, currentSeat, deliverablesOnlyProjects } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** A client: its short code and its projects (/clients/<client>), reached
 *  from the Clients menu or a project's back link. */
export default async function ClientPage({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const supabase = await createClient();
  const [directory, seat] = await Promise.all([loadDirectory(supabase), currentSeat()]);
  const client = directory.clients.find((c) => c.slug === slug);
  if (!client) notFound();
  // The client's code and new projects under it are workspace things.
  const editor = canEditWorkspace(seat);
  const projects = directory.projects.filter((p) => p.clientId === client.id);
  const { rows, error } = projects.length
    ? await loadTranscripts(supabase, { projectIds: projects.map((p) => p.id) })
    : { rows: [], error: null };
  const clientOnly = await deliverablesOnlyProjects();
  const progress = await loadProgress(
    supabase,
    projects.map((p) => p.id),
    rows,
  );

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">Client</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 26, margin: 0 }}>{client.name}</h2>
            <ClientCode clientId={client.id} code={client.code} editor={editor} />
          </span>
          <p className="meta">
            {projects.length} project{projects.length === 1 ? "" : "s"} · {rows.length} interview{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        {editor && (
          <div style={{ marginLeft: "auto" }}>
            <SourcesActions directory={directory} clientId={client.id} />
          </div>
        )}
      </div>

      {error && (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">Could not read this client&apos;s transcripts: {error}</p>
        </div>
      )}

      {!projects.length ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta" style={{ margin: 0 }}>No projects yet. Start one with New project.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "var(--space-3)" }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} path={p.path} name={p.name} progress={progress.get(p.id)!} deliverablesOnly={clientOnly.has(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
