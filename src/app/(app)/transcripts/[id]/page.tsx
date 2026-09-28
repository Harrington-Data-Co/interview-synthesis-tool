import Link from "next/link";
import { notFound } from "next/navigation";
import {
  TranscriptLines,
  TryEditButton,
  type LineView,
  type SpeakerRole,
} from "@/components/transcript/TranscriptLines";
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
      "id,title,participant,participant_role,source,original_name,sha256,duration_mins,recorded_on,status,ingested_at,ingested_by,project:project_id(name,client:client_id(name))",
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

  const [{ data: speakers }, { data: ingester }] = await Promise.all([
    supabase.from("transcript_speaker").select("name,role").eq("transcript_id", id),
    supabase.from("seat").select("name").eq("user_id", t.ingested_by).maybeSingle(),
  ]);
  const roles: Record<string, SpeakerRole> = Object.fromEntries(
    (speakers ?? []).map((s) => [s.name, s.role as SpeakerRole]),
  );
  const turns = new Map<string, number>();
  lines.forEach((l) => turns.set(l.speaker, (turns.get(l.speaker) ?? 0) + 1));

  const project = t.project as unknown as { name: string; client: { name: string } | null } | null;
  const ingested = new Date(t.ingested_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const record: [string, React.ReactNode][] = [
    ["File", <span key="f" className="mono" style={{ fontSize: 12 }}>{t.original_name ?? "—"}</span>],
    ["Source", SOURCE_LABEL[t.source] ?? t.source],
    ["Participant", [t.participant, t.participant_role].filter(Boolean).join(" — ") || "—"],
    ["Recorded", t.recorded_on ?? "—"],
    ["Length", `${t.duration_mins ? `${t.duration_mins} min · ` : ""}${lines.length} turns`],
    ["Project", project ? `${project.client?.name ? `${project.client.name} · ` : ""}${project.name}` : "Unassigned"],
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
        </div>

        <div className="card" style={{ gap: "var(--space-3)" }}>
          <span className="card-kicker">Speakers</span>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto auto", gap: "var(--space-2) var(--space-4)", fontSize: 13 }}>
            {[...turns].map(([name, n]) => (
              <div key={name} style={{ display: "contents" }}>
                <dt>{name}</dt>
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

      <TranscriptLines lines={lines} roles={roles} checksum={t.sha256} />
    </main>
  );
}
