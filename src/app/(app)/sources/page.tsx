import Link from "next/link";
import { GoogleConnection } from "@/components/connectors/GoogleConnection";
import { AssignProject } from "@/components/sources/AssignProject";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { loadDirectory } from "@/lib/directory";
import { loadTranscripts, participantsOf, SOURCE_LABEL, type TranscriptRow } from "@/lib/library";
import { googleConfigured } from "@/lib/connectors/google";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** The library: an Unassigned queue of transcripts not yet in a project,
 *  then every client with its projects. A transcript lives under its project
 *  once assigned; its page is one click from there. */
export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ google?: string; reason?: string }> }) {
  const query = await searchParams;
  const seat = await currentSeat();
  const editor = canEdit(seat);
  const supabase = await createClient();
  const [{ rows, error }, directory, { data: google, error: googleError }] = await Promise.all([
    loadTranscripts(supabase),
    loadDirectory(supabase),
    supabase.from("connector_account").select("account_email").eq("provider", "google").maybeSingle(),
  ]);
  const googleState = !googleConfigured()
    ? "unconfigured"
    : googleError
      ? "needs-migration"
      : google
        ? "connected"
        : "disconnected";
  const googleNotice =
    query.google === "connected"
      ? { tone: "info" as const, text: "Google Drive is connected." }
      : query.google === "declined"
        ? { tone: "error" as const, text: "Google Drive wasn't connected: access was declined." }
        : query.google === "failed"
          ? { tone: "error" as const, text: query.reason ?? "Connecting Google Drive failed. Try again." }
          : null;

  const unassigned = rows.filter((t) => !t.project_id);
  const byProject = new Map<string, TranscriptRow[]>();
  for (const t of rows) if (t.project_id) byProject.set(t.project_id, [...(byProject.get(t.project_id) ?? []), t]);

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">00 · Sources</span>
          <h2 style={{ fontSize: 20 }}>Transcript library</h2>
          <p className="meta">New transcripts wait in Unassigned until they&apos;re placed in a client&apos;s project.</p>
        </div>
        {editor && (
          <div style={{ marginLeft: "auto" }}>
            <SourcesActions directory={directory} />
          </div>
        )}
      </div>

      <GoogleConnection state={googleState} email={google?.account_email ?? null} editor={editor} notice={googleNotice} directory={directory} />

      {error && (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">
            Could not read the library: {error}. Have the files in <code>supabase/migrations</code> been applied?
          </p>
        </div>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>Unassigned</h3>
          <span className="tag tag-neutral">{unassigned.length}</span>
        </div>
        {!unassigned.length ? (
          <div className="panel" style={{ padding: "var(--space-4)" }}>
            <p className="meta" style={{ margin: 0 }}>
              {rows.length
                ? "Nothing waiting — every transcript is in a project."
                : "Nothing ingested yet. Add a Google Meet .docx, a Teams .vtt, or paste a Wispr Flow transcript."}
            </p>
          </div>
        ) : (
          <div className="panel" style={{ overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Transcript</th>
                  <th>Participant</th>
                  <th>Source</th>
                  <th>Recorded</th>
                  <th>Length</th>
                  <th>Project</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/transcripts/${t.id}`}>{t.title}</Link>
                    </td>
                    <td>{participantsOf(t)}</td>
                    <td>{SOURCE_LABEL[t.source] ?? t.source}</td>
                    <td className="mono">{t.recorded_on ?? "—"}</td>
                    <td className="mono">{t.duration_mins ? `${t.duration_mins} min` : "—"}</td>
                    <td>
                      {editor ? (
                        <AssignProject transcriptId={t.id} projectId={null} directory={directory} />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>Clients and projects</h3>
        {!directory.clients.length && (
          <div className="panel" style={{ padding: "var(--space-4)" }}>
            <p className="meta" style={{ margin: 0 }}>No clients yet. Start one with New project.</p>
          </div>
        )}
        {directory.clients.map((c) => {
          const projects = directory.projects.filter((p) => p.clientId === c.id);
          return (
            <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span className="kicker">{c.name}</span>
              {!projects.length ? (
                <p className="meta" style={{ margin: 0 }}>No projects yet.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "var(--space-3)" }}>
                  {projects.map((p) => (
                    <ProjectCard key={p.id} id={p.id} name={p.name} transcripts={byProject.get(p.id) ?? []} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function ProjectCard({ id, name, transcripts }: { id: string; name: string; transcripts: TranscriptRow[] }) {
  const minutes = transcripts.reduce((sum, t) => sum + (t.duration_mins ?? 0), 0);
  const coded = transcripts.filter((t) => t.status === "coded").length;
  const latest = transcripts.find((t) => t.recorded_on)?.recorded_on;
  return (
    <Link
      href={`/projects/${id}`}
      className="card"
      style={{ gap: "var(--space-2)", textDecoration: "none", color: "inherit" }}
    >
      <span style={{ fontWeight: 700, fontSize: 15 }}>{name}</span>
      <span className="meta" style={{ fontSize: 12.5 }}>
        {transcripts.length} interview{transcripts.length === 1 ? "" : "s"}
        {minutes ? ` · ${minutes} min` : ""}
        {latest ? ` · latest ${latest}` : ""}
      </span>
      <span style={{ display: "flex", gap: 6 }}>
        <span className="tag tag-neutral">{transcripts.length - coded} to code</span>
        <span className={`tag ${coded ? "tag-accent" : "tag-neutral"}`}>{coded} coded</span>
      </span>
    </Link>
  );
}
