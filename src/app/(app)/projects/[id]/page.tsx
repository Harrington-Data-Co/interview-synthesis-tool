import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectInterviews } from "@/components/project/ProjectInterviews";
import type { LabelAxis, LabelMap } from "@/components/project/labels";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { loadDirectory } from "@/lib/directory";
import { loadTranscripts, participantNames, participantOrgIds, SOURCE_LABEL } from "@/lib/library";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One project: its interviews, who was interviewed and which organizations
 *  they came from. The Study stages (codes, notes, themes) land here in
 *  Phases 2–4. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [directory, seat, { rows, error }, { data: axisRows }] = await Promise.all([
    loadDirectory(supabase),
    currentSeat(),
    loadTranscripts(supabase, { projectId: id }),
    supabase
      .from("label_axis")
      .select("id,name,ordinal,options:label_option(id,value,ordinal)")
      .eq("project_id", id)
      .order("ordinal"),
  ]);
  const editor = canEdit(seat);

  const axes: LabelAxis[] = (axisRows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    options: [...(a.options ?? [])].sort((x, y) => x.ordinal - y.ordinal).map((o) => ({ id: o.id, value: o.value })),
  }));
  const labels: LabelMap = {};
  if (axes.length && rows.length) {
    const { data: tl } = await supabase
      .from("transcript_label")
      .select("transcript_id,axis_id,option_id")
      .in("axis_id", axes.map((a) => a.id));
    for (const l of tl ?? []) (labels[l.transcript_id] ??= {})[l.axis_id] = l.option_id;
  }

  const project = directory.projects.find((p) => p.id === id);
  if (!project) notFound();
  const client = directory.clients.find((c) => c.id === project.clientId);
  const orgPath = new Map(directory.organizations.map((o) => [o.id, o.path]));

  const interviews = rows.map((t) => ({
    id: t.id,
    title: t.title,
    participants: participantNames(t),
    organizations: participantOrgIds(t)
      .map((o) => orgPath.get(o))
      .filter((p): p is string => !!p),
    recordedOn: t.recorded_on,
    durationMins: t.duration_mins,
    source: SOURCE_LABEL[t.source] ?? t.source,
    status: t.status,
  }));

  const minutes = rows.reduce((sum, t) => sum + (t.duration_mins ?? 0), 0);
  const stats: [string, string | number][] = [
    ["Interviews", rows.length],
    ["Minutes", minutes || "—"],
    ["Participants", new Set(interviews.flatMap((t) => t.participants)).size],
    ["Organizations", new Set(interviews.flatMap((t) => t.organizations)).size],
  ];

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 1400 }}>
      <Link href="/sources" className="meta">
        ← Transcript library
      </Link>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">{client?.name ?? "Client"}</span>
          <h2 style={{ fontSize: 26, margin: 0 }}>{project.name}</h2>
        </div>
        {editor && (
          <div style={{ marginLeft: "auto" }}>
            <SourcesActions directory={directory} projectId={id} newProject={false} />
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "var(--space-3)" }}>
        {stats.map(([k, v]) => (
          <div key={k} className="card" style={{ gap: 2 }}>
            <span className="card-kicker">{k}</span>
            <span style={{ fontSize: 24, fontWeight: 700 }}>{v}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">Could not read this project&apos;s transcripts: {error}</p>
        </div>
      )}

      <ProjectInterviews projectId={id} editor={editor} axes={axes} labels={labels} rows={interviews} />

      <p className="meta" style={{ margin: 0 }}>
        Coding, interview notes and themes for this project arrive with Phases 2–4.
      </p>
    </div>
  );
}
