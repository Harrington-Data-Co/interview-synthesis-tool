import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchStage } from "@/components/arch/ArchStage";
import { ChainStage } from "@/components/chain/ChainStage";
import { CorpusStage } from "@/components/corpus/CorpusStage";
import { DeckStage } from "@/components/deck/DeckStage";
import { FlowStage } from "@/components/flow/FlowStage";
import { CodeAllButton, GenerateNotesButton } from "@/components/project/BatchButton";
import { ProjectInterviews } from "@/components/project/ProjectInterviews";
import { ProjectTabs, VIEWS, type ViewKey } from "@/components/project/ProjectTabs";
import type { LabelAxis, LabelMap } from "@/components/project/labels";
import { MemoStage } from "@/components/memo/MemoStage";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { ThemesStage } from "@/components/themes/ThemesStage";
import { loadDirectory, clientLabel } from "@/lib/directory";
import { loadTranscripts, participantNames, participantOrgIds, SOURCE_LABEL } from "@/lib/library";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** One project: its interviews (with labels, notes and coding), the themes
 *  across them, the findings memo written from those themes, one interview's
 *  chain from line to memo, and the corpus views across all of them. */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    view?: string;
    template?: string;
    interview?: string;
    note?: string;
    memo?: string;
    facet?: string;
    proposed?: string;
    map?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const view: ViewKey = VIEWS.some(([k]) => k === query.view) ? (query.view as ViewKey) : "interviews";
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [directory, seat, { rows, error }, { data: axisRows }, { data: templates }] = await Promise.all([
    loadDirectory(supabase),
    currentSeat(),
    loadTranscripts(supabase, { projectId: id }),
    supabase
      .from("label_axis")
      .select("id,name,ordinal,options:label_option(id,value,ordinal)")
      .eq("project_id", id)
      .order("ordinal"),
    supabase.from("note_template").select("id,name,notes:note(transcript_id)").eq("project_id", id).order("name"),
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
    organizationIds: participantOrgIds(t),
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
    <div
      style={{
        padding: "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        // Centred, so spare width falls evenly on both sides; the chain board
        // uses the full width.
        maxWidth: view === "chain" ? undefined : 1400,
        width: "100%",
        margin: "0 auto",
      }}
    >
      <Link href="/sources" className="meta">
        ← Transcript library
      </Link>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">{client ? clientLabel(client) : "Client"}</span>
          <h2 style={{ fontSize: 26, margin: 0 }}>{project.name}</h2>
        </div>
        {editor && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
            <CodeAllButton
              targets={rows.filter((t) => t.status !== "coded").map((t) => ({ id: t.id, title: t.title }))}
            />
            <GenerateNotesButton
              templates={(templates ?? []).map((tp) => {
                const noted = new Set((tp.notes ?? []).map((n: { transcript_id: string }) => n.transcript_id));
                return {
                  id: tp.id,
                  name: tp.name,
                  // Coded interviews without a note from this template yet.
                  targets: rows.filter((t) => t.status === "coded" && !noted.has(t.id)).map((t) => ({ id: t.id, title: t.title })),
                };
              })}
            />
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

      <ProjectTabs projectId={id} view={view} />

      {view === "interviews" && (
        <>
          <ProjectInterviews projectId={id} editor={editor} axes={axes} labels={labels} rows={interviews} organizations={directory.organizations} />
          <p className="meta" style={{ margin: 0 }}>
            Open an interview to review its codes and notes.
          </p>
        </>
      )}
      {view === "themes" && <ThemesStage projectId={id} editor={editor} />}
      {view === "memo" && <MemoStage projectId={id} templateId={query.template} editor={editor} />}
      {view === "deck" && <DeckStage projectId={id} templateId={query.template} editor={editor} />}
      {view === "swimlanes" && <FlowStage projectId={id} mapId={query.map} editor={editor} />}
      {view === "architecture" && <ArchStage projectId={id} mapId={query.map} editor={editor} />}
      {view === "chain" && (
        <ChainStage
          projectId={id}
          interviewId={query.interview}
          noteTemplateId={query.note}
          memoTemplateId={query.memo}
          withProposed={query.proposed === "1"}
        />
      )}
      {view === "corpus" && <CorpusStage projectId={id} facetId={query.facet} withProposed={query.proposed === "1"} />}
    </div>
  );
}
