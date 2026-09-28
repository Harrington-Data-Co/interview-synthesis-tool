import Link from "next/link";
import { notFound } from "next/navigation";
import { EditRecordButton } from "@/components/transcript/EditRecord";
import {
  TranscriptLines,
  TryEditButton,
  type LineView,
  type SpeakerRole,
} from "@/components/transcript/TranscriptLines";
import { loadDirectory } from "@/lib/directory";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

const SOURCE_LABEL: Record<string, string> = {
  meet: "Google Meet",
  wispr: "Wispr Flow",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  otter: "Otter.ai",
  granola: "Granola",
  upload: "Upload",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000; // PostgREST's default row cap

const muted = { color: "color-mix(in srgb, var(--color-text) 55%, transparent)" } as const;

export default async function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const { data: t } = await supabase
    .from("transcript")
    .select(
      "id,title,participant,participant_role,source,original_name,sha256,duration_mins,recorded_on,status,ingested_at,ingested_by,project_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();

  // Lines in pages: a long interview can pass PostgREST's 1000-row cap.
  const lines: LineView[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("transcript_line")
      .select("n,speaker,text,ts_start")
      .eq("transcript_id", id)
      .order("n")
      .range(from, from + PAGE - 1);
    lines.push(...(data ?? []).map((l) => ({ n: l.n, speaker: l.speaker, text: l.text, at: l.ts_start })));
    if (!data || data.length < PAGE) break;
  }

  const [{ data: speakers }, { data: ingester }, directory, seat] = await Promise.all([
    supabase.from("transcript_speaker").select("name,role,display_name,organization_id").eq("transcript_id", id),
    supabase.from("seat").select("name").eq("user_id", t.ingested_by).maybeSingle(),
    loadDirectory(supabase),
    currentSeat(),
  ]);
  const roles: Record<string, SpeakerRole> = Object.fromEntries(
    (speakers ?? []).map((s) => [s.name, s.role as SpeakerRole]),
  );
  const names: Record<string, string> = Object.fromEntries(
    (speakers ?? []).filter((s) => s.display_name).map((s) => [s.name, s.display_name as string]),
  );
  const orgPath = new Map(directory.organizations.map((o) => [o.id, o.path]));
  const speakerOrg = new Map((speakers ?? []).map((s) => [s.name, s.organization_id as string | null]));
  const turns = new Map<string, number>();
  lines.forEach((l) => turns.set(l.speaker, (turns.get(l.speaker) ?? 0) + 1));

  const project = directory.projects.find((p) => p.id === t.project_id);
  const client = project && directory.clients.find((c) => c.id === project.clientId);
  const participantOrgs = [
    ...new Set(
      (speakers ?? [])
        .filter((s) => s.role === "participant" && s.organization_id)
        .map((s) => orgPath.get(s.organization_id as string))
        .filter(Boolean),
    ),
  ].join(", ");
  const ingested = new Date(t.ingested_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const record: [string, React.ReactNode][] = [
    ["File", <span key="f" className="mono" style={{ fontSize: 12 }}>{t.original_name ?? "—"}</span>],
    ["Source", SOURCE_LABEL[t.source] ?? t.source],
    ["Participant", [t.participant, t.participant_role].filter(Boolean).join(" — ") || "—"],
    ["Organization", participantOrgs || "—"],
    ["Recorded", t.recorded_on ?? "—"],
    ["Length", `${t.duration_mins ? `${t.duration_mins} min · ` : ""}${lines.length} turns`],
    ["Client", client?.name ?? "—"],
    ["Project", project?.name ?? "Unassigned"],
  ];

  return (
    <main
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
        gap: "var(--space-8)",
        padding: "var(--space-6)",
        alignItems: "start",
        maxWidth: 1600,
        width: "100%",
        margin: "0 auto",
      }}
    >
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Link href="/sources" className="meta">
          ← Transcript library
        </Link>
        <span className="kicker">01 · Transcript</span>
        <h2 style={{ fontSize: 28, margin: 0 }}>{t.title}</h2>
        <p style={{ fontSize: 14, maxWidth: "46ch", margin: 0, color: "color-mix(in srgb, var(--color-text) 72%, transparent)" }}>
          Nothing is inferred yet. Every line has a permanent address — <strong>L14</strong> — and every claim
          downstream has to point back at one of them.
        </p>

        <div className="card" style={{ gap: "var(--space-3)" }}>
          <span className="card-kicker">Source record</span>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--space-2) var(--space-4)", fontSize: 13 }}>
            {record.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={muted}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
          {canEdit(seat) && (
            <EditRecordButton
              record={{
                id: t.id,
                title: t.title,
                participant: t.participant,
                participantRole: t.participant_role,
                recordedOn: t.recorded_on,
                projectId: t.project_id,
              }}
              speakers={[...turns].map(([name, n]) => ({
                name,
                displayName: names[name] ?? null,
                role: roles[name] ?? "other",
                organizationId: speakerOrg.get(name) ?? null,
                turns: n,
              }))}
              directory={directory}
            />
          )}
        </div>

        <div className="card" style={{ gap: "var(--space-3)" }}>
          <span className="card-kicker">Speakers</span>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto auto", gap: "var(--space-2) var(--space-4)", fontSize: 13 }}>
            {[...turns].map(([name, n]) => (
              <div key={name} style={{ display: "contents" }}>
                <dt>
                  {names[name] ?? name}
                  {(names[name] || speakerOrg.get(name)) && (
                    <span style={{ display: "block", fontSize: 11.5, ...muted }}>
                      {[
                        speakerOrg.get(name) && orgPath.get(speakerOrg.get(name) as string),
                        names[name] && `written as “${name}”`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </dt>
                <dd className="mono" style={{ margin: 0, ...muted, fontSize: 12 }}>{n} turns</dd>
                <dd style={{ margin: 0 }}>
                  <span className={`tag ${roles[name] === "participant" ? "tag-accent" : "tag-neutral"}`}>
                    {roles[name] ?? "other"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div
          className="panel"
          style={{
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-navy)" }}>
            Locked — source of record
          </span>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "color-mix(in srgb, var(--color-text) 75%, transparent)" }}>
            No role can alter a transcript, owners included. What someone said is the one fixed thing in the chain;
            corrections belong in the layer above, where they carry a name.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px var(--space-4)", fontSize: 11.5 }}>
            <span style={muted}>Checksum</span>
            <span className="mono" style={{ wordBreak: "break-all" }}>{t.sha256}</span>
            <span style={muted}>Ingested</span>
            <span>
              {ingested} · {ingester?.name ?? "unknown"}
            </span>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <TryEditButton />
            <a className="btn btn-ghost" style={{ fontSize: 11.5 }} href={`/api/transcripts/${t.id}/original`}>
              Download original
            </a>
          </div>
        </div>
      </section>

      <TranscriptLines lines={lines} roles={roles} names={names} checksum={t.sha256} />
    </main>
  );
}
