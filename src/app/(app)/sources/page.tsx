import Link from "next/link";
import { GoogleConnection } from "@/components/connectors/GoogleConnection";
import { AssignProject } from "@/components/sources/AssignProject";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { loadDirectory } from "@/lib/directory";
import { loadTranscripts, participantsOf, SOURCE_LABEL} from "@/lib/library";
import { googleConfigured } from "@/lib/connectors/google";
import { redirect } from "next/navigation";
import { canEditWorkspace, currentSeat, isStaff } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Intake: new Meet transcripts waiting in Drive, and the Unassigned queue
 *  of transcripts not yet in a project. Once assigned, a transcript lives
 *  under its project (the home page and the Clients menu). */
export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ google?: string; reason?: string }> }) {
  const query = await searchParams;
  const seat = await currentSeat();
  if (!isStaff(seat)) redirect("/");
  const editor = canEditWorkspace(seat);
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

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">Sources</span>
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

    </div>
  );
}
