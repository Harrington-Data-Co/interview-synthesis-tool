import { createClient } from "@/lib/supabase/server";

export default async function SourcesPage() {
  const supabase = await createClient();
  const { data: transcripts, error } = await supabase
    .from("transcript")
    .select("id,title,participant,source,duration_mins,recorded_on,status")
    .order("ingested_at", { ascending: false });

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">00 · Sources</span>
        <h2 style={{ fontSize: 20 }}>Transcript library</h2>
        <p className="meta">
          Where transcripts come from. Manual upload first; connectors follow.
        </p>
      </div>

      {error ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">
            Could not read the library: {error.message}. Has{" "}
            <code>supabase/schema.sql</code> been applied?
          </p>
        </div>
      ) : !transcripts?.length ? (
        <div className="panel" style={{ padding: "var(--space-8)", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--color-muted)" }}>
            Nothing ingested yet. Upload a <code>.vtt</code>, <code>.srt</code>,{" "}
            <code>.txt</code> or <code>.docx</code> to start.
          </p>
        </div>
      ) : (
        <div className="panel" style={{ overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Transcript</th>
                <th>Participant</th>
                <th>Source</th>
                <th>Length</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transcripts.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{t.participant ?? "—"}</td>
                  <td>{t.source}</td>
                  <td className="mono">{t.duration_mins ? `${t.duration_mins} min` : "—"}</td>
                  <td>
                    <span className="tag tag-neutral">{t.status}</span>
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
