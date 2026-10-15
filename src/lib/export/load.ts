import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import { SOURCE_LABEL } from "@/lib/library";
import { loadProjectEvidence } from "@/lib/themes/evidence";
import type { ExportCode, ExportLine } from "./coding";
import type { CodesExport } from "./codes";
import type { NoteExport, ProjectNotesExport } from "./notes";
import type { ThemeExport } from "./themes";

const PAGE = 1000; // PostgREST's default row cap

/** A transcript's lines and codes for the coding spreadsheet. Row-level
 *  security decides what the person may read; a transcript they can't see
 *  is the same 404 as one that isn't there. */
export async function loadCodingExport(supabase: SupabaseClient, transcriptId: string) {
  const { data: t } = await supabase.from("transcript").select("id,title,project_id").eq("id", transcriptId).maybeSingle();
  if (!t) throw new ApiError("Unknown transcript.", 404);

  const lines: ExportLine[] = [];
  const [{ data: speakers }, { data: codes }] = await Promise.all([
    supabase.from("transcript_speaker").select("name,role,display_name").eq("transcript_id", transcriptId),
    supabase
      .from("code")
      .select("id,ref,type,label,verbatim,note,line_start,line_end,origin,merged_into_id")
      .eq("transcript_id", transcriptId)
      .order("line_start")
      .order("ref"),
  ]);
  const who = new Map((speakers ?? []).map((s) => [s.name, s]));
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("transcript_line")
      .select("n,speaker,text,ts_start")
      .eq("transcript_id", transcriptId)
      .order("n")
      .range(from, from + PAGE - 1);
    lines.push(
      ...(data ?? []).map((l) => ({
        n: l.n,
        at: l.ts_start,
        speaker: who.get(l.speaker)?.display_name ?? l.speaker,
        role: who.get(l.speaker)?.role ?? "other",
        text: l.text,
      })),
    );
    if (!data || data.length < PAGE) break;
  }
  return { title: t.title as string, lines, codes: (codes ?? []) as ExportCode[] };
}

/** One interview's note for a template (the chosen one, else the first the
 *  interview has a note for). Null if there's no note to export. */
export async function loadNoteExport(supabase: SupabaseClient, transcriptId: string, templateId?: string): Promise<NoteExport | null> {
  const { data: t } = await supabase
    .from("transcript")
    .select("id,title,project:project_id(name,client:client_id(name))")
    .eq("id", transcriptId)
    .maybeSingle();
  if (!t) throw new ApiError("Unknown transcript.", 404);
  const { data: notes } = await supabase
    .from("note")
    .select("id,template:template_id(id,name,sections:note_section(id,ordinal,name))")
    .eq("transcript_id", transcriptId);
  type Tpl = { id: string; name: string; sections: { id: string; ordinal: number; name: string }[] };
  // Supabase types a to-one embed as maybe-array; at runtime it is the object.
  const rows = (notes ?? []).map((n) => ({ id: n.id as string, template: n.template as unknown as Tpl }));
  const note = rows.find((n) => n.template.id === templateId) ?? rows[0];
  if (!note) return null;

  const [{ data: items }, { data: codes }] = await Promise.all([
    supabase
      .from("note_item")
      .select("section_id,ordinal,text,codes:note_item_code(code_id)")
      .eq("note_id", note.id)
      .order("ordinal"),
    supabase.from("code").select("id,ref,label,verbatim,line_start,line_end").eq("transcript_id", transcriptId),
  ]);
  const project = t.project as unknown as { name: string; client: { name: string } | null } | null;
  return {
    transcript: t.title,
    project: project?.name ?? null,
    client: project?.client?.name ?? null,
    template: note.template.name,
    sections: [...note.template.sections]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({
        name: s.name,
        items: (items ?? [])
          .filter((i) => i.section_id === s.id)
          .map((i) => ({ text: i.text, codeIds: (i.codes ?? []).map((c: { code_id: string }) => c.code_id) })),
      })),
    codes: new Map((codes ?? []).map((c) => [c.id, c])),
  };
}

/** A project's themes and the evidence under them. Confirmed first, then
 *  proposed, each in the order the Themes view keeps them. */
export async function loadThemesExport(supabase: SupabaseClient, projectId: string): Promise<ThemeExport> {
  const [{ data: project }, evidence, { data: rows }] = await Promise.all([
    supabase.from("project").select("name,client:client_id(name)").eq("id", projectId).maybeSingle(),
    loadProjectEvidence(supabase, projectId),
    supabase
      .from("theme")
      .select("id,ref,title,description,status,origin,codes:theme_code(code_id)")
      .eq("project_id", projectId)
      .order("status", { ascending: true })
      .order("ordinal"),
  ]);
  if (!project) throw new ApiError("Unknown project.", 404);
  const active = new Set(evidence.codes.map((c) => c.id));
  const client = project.client as unknown as { name: string } | null;
  return {
    project: project.name,
    client: client?.name ?? null,
    themes: (rows ?? []).map((th) => ({
      id: th.id,
      ref: th.ref,
      title: th.title,
      description: th.description,
      status: th.status,
      origin: th.origin,
      codeIds: (th.codes ?? []).map((c: { code_id: string }) => c.code_id).filter((id: string) => active.has(id)),
    })),
    codes: new Map(evidence.codes.map((c) => [c.id, c])),
    interviews: new Map(evidence.interviews.map((i) => [i.id, i])),
  };
}

/** Every code in a project — merged ones too, since the merge is part of
 *  how the coding got where it is — with its interview and themes. */
export async function loadCodesExport(supabase: SupabaseClient, projectId: string): Promise<{ name: string; data: CodesExport }> {
  const [{ data: project }, evidence, { data: ts }, { data: themeRows }] = await Promise.all([
    supabase.from("project").select("name").eq("id", projectId).maybeSingle(),
    loadProjectEvidence(supabase, projectId),
    supabase.from("transcript").select("id,source,status,recorded_on").eq("project_id", projectId),
    supabase.from("theme").select("id,ref,title,status,ordinal,codes:theme_code(code_id)").eq("project_id", projectId).order("ordinal"),
  ]);
  if (!project) throw new ApiError("Unknown project.", 404);
  const meta = new Map((ts ?? []).map((t) => [t.id, t]));

  const codes: CodesExport["codes"] = [];
  const ids = [...meta.keys()];
  for (let from = 0; ids.length; from += PAGE) {
    const { data } = await supabase
      .from("code")
      .select("id,transcript_id,ref,type,label,verbatim,note,line_start,line_end,origin,merged_into_id")
      .in("transcript_id", ids)
      .order("transcript_id")
      .order("line_start")
      .order("ref")
      .range(from, from + PAGE - 1);
    codes.push(...(data ?? []).map((c) => ({ ...c, transcriptId: c.transcript_id })));
    if (!data || data.length < PAGE) break;
  }

  const themesOf = new Map<string, string[]>();
  for (const th of themeRows ?? []) {
    for (const c of th.codes ?? []) themesOf.set(c.code_id, [...(themesOf.get(c.code_id) ?? []), th.ref]);
  }
  return {
    name: project.name,
    data: {
      interviews: evidence.interviews.map((i) => ({
        id: i.id,
        key: i.key,
        title: i.title,
        participant: i.participant,
        organization: i.organization,
        role: i.role,
        recordedOn: meta.get(i.id)?.recorded_on ?? null,
        source: SOURCE_LABEL[meta.get(i.id)?.source] ?? meta.get(i.id)?.source ?? "",
        status: meta.get(i.id)?.status ?? "",
      })),
      codes,
      themesOf,
      themes: (themeRows ?? []).map((t) => ({ ref: t.ref, title: t.title, status: t.status })),
    },
  };
}

/** The notes of a project's interviews — all of them, or only `only` — in
 *  recording order. Interviews with no note are left out. Null if none has. */
export async function loadProjectNotesExport(supabase: SupabaseClient, projectId: string, only?: string[]): Promise<ProjectNotesExport | null> {
  const [{ data: project }, evidence] = await Promise.all([
    supabase.from("project").select("name,client:client_id(name)").eq("id", projectId).maybeSingle(),
    loadProjectEvidence(supabase, projectId),
  ]);
  if (!project) throw new ApiError("Unknown project.", 404);
  let q = supabase
    .from("transcript")
    .select("id,title,recorded_on")
    .eq("project_id", projectId)
    .order("recorded_on", { ascending: true, nullsFirst: false })
    .order("title");
  if (only) q = q.in("id", only);
  const { data: ts } = await q;
  const ids = (ts ?? []).map((t) => t.id);
  if (!ids.length) return null;

  type Tpl = { name: string; ordinal?: number; sections: { id: string; ordinal: number; name: string }[] };
  const [{ data: notes }, codes] = await Promise.all([
    supabase.from("note").select("id,transcript_id,template:template_id(name,sections:note_section(id,ordinal,name))").in("transcript_id", ids),
    pageAll((from, to) =>
      supabase.from("code").select("id,transcript_id,ref,label,verbatim,line_start,line_end").in("transcript_id", ids).order("id").range(from, to),
    ),
  ]);
  const noteIds = (notes ?? []).map((n) => n.id);
  if (!noteIds.length) return null;
  const items = await pageAll((from, to) =>
    supabase
      .from("note_item")
      .select("note_id,section_id,ordinal,text,codes:note_item_code(code_id)")
      .in("note_id", noteIds)
      .order("note_id")
      .order("ordinal")
      .range(from, to),
  );

  const iv = new Map(evidence.interviews.map((i) => [i.id, i]));
  const client = project.client as unknown as { name: string } | null;
  const interviews: ProjectNotesExport["interviews"] = [];
  for (const t of ts ?? []) {
    const mine = (notes ?? []).filter((n) => n.transcript_id === t.id);
    if (!mine.length) continue;
    const who = iv.get(t.id);
    interviews.push({
      title: t.title,
      meta: [who?.participant, who?.organization, t.recorded_on].filter(Boolean).join(" · "),
      notes: mine
        .map((n) => ({ tpl: n.template as unknown as Tpl, id: n.id as string }))
        .sort((a, b) => a.tpl.name.localeCompare(b.tpl.name))
        .map(({ tpl, id }) => ({
          template: tpl.name,
          sections: [...tpl.sections]
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((s) => ({
              name: s.name,
              items: items
                .filter((i) => i.note_id === id && i.section_id === s.id)
                .map((i) => ({ text: i.text, codeIds: (i.codes ?? []).map((c: { code_id: string }) => c.code_id) })),
            })),
        })),
      codes: new Map(codes.filter((c) => c.transcript_id === t.id).map((c) => [c.id, c])),
    });
  }
  return interviews.length ? { project: project.name, client: client?.name ?? null, interviews } : null;
}

/** All rows of a query, a page at a time (PostgREST caps a response at 1000). */
async function pageAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await page(from, from + PAGE - 1);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
