import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArchStage } from "@/components/arch/ArchStage";
import { ChainStage } from "@/components/chain/ChainStage";
import { CorpusStage } from "@/components/corpus/CorpusStage";
import { DeckStage } from "@/components/deck/DeckStage";
import { FlowStage } from "@/components/flow/FlowStage";
import { CodeAllButton, GenerateNotesButton } from "@/components/project/BatchButton";
import { ProjectInterviews } from "@/components/project/ProjectInterviews";
import { ProjectTabs } from "@/components/project/ProjectTabs";
import type { LabelAxis, LabelMap } from "@/components/project/labels";
import { MemoStage } from "@/components/memo/MemoStage";
import { SourcesActions } from "@/components/sources/SourcesActions";
import { ThemesStage } from "@/components/themes/ThemesStage";
import { loadDirectory, clientLabel } from "@/lib/directory";
import { loadTranscripts, participantNames, participantOrgIds, SOURCE_LABEL } from "@/lib/library";
import { ProjectMembers } from "@/components/project/ProjectMembers";
import { projectAccess } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";
import { clientPath, DELIVERABLE_VIEWS, findProjectId, projectHref, type ViewKey } from "@/lib/urls";

export type ProjectQuery = {
  template?: string;
  interview?: string;
  note?: string;
  memo?: string;
  facet?: string;
  proposed?: string;
  map?: string;
};

/** One project: its interviews (with labels, notes and coding), the themes
 *  across them, the findings memo written from those themes, one interview's
 *  chain from line to memo, and the corpus views across all of them. Found
 *  by its client's slug and its own (/clients/<client>/<project>/<tab>). */
export async function ProjectPage({
  clientSlug,
  projectSlug,
  view,
  query,
}: {
  clientSlug: string;
  projectSlug: string;
  view: ViewKey;
  query: ProjectQuery;
}) {
  const supabase = await createClient();
  const id = await findProjectId(supabase, clientSlug, projectSlug);
  if (!id) notFound();
  const access = await projectAccess(id);
  if (!access) notFound();
  const allowed = access.full ? undefined : DELIVERABLE_VIEWS;
  const [directory, { rows, error }, { data: axisRows }, { data: templates }] = await Promise.all([
    loadDirectory(supabase),
    loadTranscripts(supabase, { projectId: id }),
    supabase
      .from("label_axis")
      .select("id,name,ordinal,options:label_option(id,value,ordinal)")
      .eq("project_id", id)
      .order("ordinal"),
    supabase.from("note_template").select("id,name,notes:note(transcript_id)").eq("project_id", id).order("name"),
  ]);
  const editor = access.edit;

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
  // Interviews, Chain and Corpus are the working layer; a client on
  // deliverables-only access starts at the memo.
  if (allowed && view !== "members" && !allowed.includes(view)) redirect(projectHref(project.path, "memo"));
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
      {client && (
        <Link href={clientPath(client.slug)} className="meta">
          ← {client.name}
        </Link>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">{client ? clientLabel(client) : "Client"}</span>
          <h2 style={{ fontSize: 26, margin: 0 }}>{project.name}</h2>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)", alignItems: "flex-start", flexWrap: "wrap" }}>
          {access.role === "client" && <span className="tag tag-neutral">Client view{access.full ? " · read-only" : ""}</span>}
          {!editor && access.role === "viewer" && <span className="tag tag-neutral">Read-only</span>}
          {(access.full || access.manage) && (
            <Link
              href={projectHref(project.path, "members")}
              className="btn btn-ghost"
              aria-current={view === "members" ? "page" : undefined}
              style={view === "members" ? { background: "var(--color-accent-tint)", fontWeight: 700 } : undefined}
            >
              Members
            </Link>
          )}
          {editor && (
            <>
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
            </>
          )}
        </div>
      </div>

      {access.full && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "var(--space-3)" }}>
          {stats.map(([k, v]) => (
            <div key={k} className="card" style={{ gap: 2 }}>
              <span className="card-kicker">{k}</span>
              <span style={{ fontSize: 24, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">Could not read this project&apos;s transcripts: {error}</p>
        </div>
      )}

      <ProjectTabs path={project.path} view={view} allowed={allowed} />

      {view === "interviews" && (
        <>
          <ProjectInterviews projectId={id} editor={editor} axes={axes} labels={labels} rows={interviews} organizations={directory.organizations} />
          <p className="meta" style={{ margin: 0 }}>
            Open an interview to review its codes and notes.
          </p>
        </>
      )}
      {view === "themes" && <ThemesStage projectId={id} editor={editor} />}
      {view === "memo" && <MemoStage projectId={id} projectPath={project.path} templateId={query.template} editor={editor} />}
      {view === "deck" && <DeckStage projectId={id} projectPath={project.path} templateId={query.template} editor={editor} />}
      {view === "swimlanes" && <FlowStage projectId={id} projectPath={project.path} mapId={query.map} editor={editor} />}
      {view === "architecture" && <ArchStage projectId={id} projectPath={project.path} mapId={query.map} editor={editor} />}
      {view === "chain" && (
        <ChainStage
          projectId={id}
          projectPath={project.path}
          interviewId={query.interview}
          noteTemplateId={query.note}
          memoTemplateId={query.memo}
          withProposed={query.proposed === "1"}
        />
      )}
      {view === "members" && <ProjectMembers projectId={id} projectName={project.name} manage={access.manage} />}
      {view === "corpus" && <CorpusStage projectId={id} projectPath={project.path} facetId={query.facet} withProposed={query.proposed === "1"} />}
    </div>
  );
}
