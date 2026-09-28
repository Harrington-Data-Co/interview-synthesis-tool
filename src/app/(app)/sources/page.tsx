import Link from "next/link";
import { AssignProject } from "@/components/sources/AssignProject";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

const SOURCE_LABEL: Record<string, string> = {
  meet: "Google Meet",
  wispr: "Wispr Flow",
  teams: "Teams",
  zoom: "Zoom",
  otter: "Otter.ai",
  granola: "Granola",
  upload: "Upload",
};

type ProjectRow = { id: string; name: string; client: { id: string; name: string } | null };

export default async function SourcesPage() {
  const seat = await currentSeat();
  const editor = canEdit(seat);
  const supabase = await createClient();

  const [{ data: transcripts, error }, { data: projectRows }, { data: clients }] = await Promise.all([
    supabase
      .from("transcript")
      .select("id,title,participant,source,duration_mins,recorded_on,status,project_id")
      .order("ingested_at", { ascending: false }),
    supabase.from("project").select("id,name,client:client_id(id,name)").order("created_at"),
    supabase.from("client").select("id,name").order("name"),
  ]);

  const projects = ((projectRows ?? []) as unknown as ProjectRow[]).map((p) => ({
    id: p.id,
    label: p.client ? `${p.client.name} · ${p.name}` : p.name,
  }));
  const projectLabel = new Map(projects.map((p) => [p.id, p.label]));

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">00 · Sources</span>
          <h2 style={{ fontSize: 20 }}>Transcript library</h2>
          <p className="meta">
            Upload an export or paste a transcript. Connectors follow.
          </p>
        </div>
        {editor && (
          <div style={{ marginLeft: "auto" }}>
            <SourcesActions projects={projects} clients={clients ?? []} />
          </div>
        )}
      </div>

      {error ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">
            Could not read the library: {error.message}. Has <code>supabase/schema.sql</code> been applied?
          </p>
        </div>
      ) : !transcripts?.length ? (
        <div className="panel" style={{ padding: "var(--space-8)", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--color-muted)" }}>
            Nothing ingested yet. Add a Google Meet <code>.docx</code>, a Teams <code>.vtt</code>, or paste a
            Wispr Flow transcript to start.
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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transcripts.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/transcripts/${t.id}`}>{t.title}</Link>
                  </td>
                  <td>{t.participant ?? "—"}</td>
                  <td>{SOURCE_LABEL[t.source] ?? t.source}</td>
                  <td className="mono">{t.recorded_on ?? "—"}</td>
                  <td className="mono">{t.duration_mins ? `${t.duration_mins} min` : "—"}</td>
                  <td>
                    {editor ? (
                      <AssignProject transcriptId={t.id} projectId={t.project_id} projects={projects} />
                    ) : (
                      (t.project_id && projectLabel.get(t.project_id)) ?? "—"
                    )}
                  </td>
                  <td>
                    <span className={`tag ${t.status === "new" ? "tag-neutral" : "tag-accent"}`}>{t.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
