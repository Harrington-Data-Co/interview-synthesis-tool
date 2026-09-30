import { foldLines, type Edge } from "@/lib/corpus/chain";
import { createClient } from "@/lib/supabase/server";
import { loadProjectEvidence } from "@/lib/themes/evidence";
import { ChainBoard, type ChainData } from "./ChainBoard";

type Section = { id: string; name: string; ordinal: number };
const byOrdinal = (a: { ordinal: number }, b: { ordinal: number }) => a.ordinal - b.ordinal;

/** Loads the chain board for one interview: the lines its codes quote, its
 *  codes, one of its notes, the themes that hold its codes, and the memo
 *  paragraphs that cite those themes or codes. Citations of a merged code
 *  are drawn to the code it was merged into. */
export async function ChainStage({
  projectId,
  interviewId,
  noteTemplateId,
  memoTemplateId,
  withProposed,
}: {
  projectId: string;
  interviewId: string | undefined;
  noteTemplateId: string | undefined;
  memoTemplateId: string | undefined;
  withProposed: boolean;
}) {
  const supabase = await createClient();
  const evidence = await loadProjectEvidence(supabase, projectId);
  const iv = evidence.interviews.find((i) => i.id === interviewId) ?? evidence.interviews[0];
  if (!iv)
    return (
      <div className="panel" style={{ padding: "var(--space-4)" }}>
        <p className="meta" style={{ margin: 0 }}>
          No coded interviews yet. Code an interview to see its chain from transcript line to memo.
        </p>
      </div>
    );

  const lines: { n: number; speaker: string; text: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("transcript_line")
      .select("n,speaker,text")
      .eq("transcript_id", iv.id)
      .order("n")
      .range(from, from + 999);
    lines.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const [{ data: speakers }, { data: allCodes }, { data: notes }, { data: themeRows }, { data: memos }] = await Promise.all([
    supabase.from("transcript_speaker").select("name,display_name,role").eq("transcript_id", iv.id),
    supabase.from("code").select("id,merged_into_id").eq("transcript_id", iv.id),
    supabase
      .from("note")
      .select("id,template_id,template:note_template(name,sections:note_section(id,name,ordinal))")
      .eq("transcript_id", iv.id),
    supabase.from("theme").select("id,ref,title,status,ordinal,codes:theme_code(code_id)").eq("project_id", projectId).order("ordinal"),
    supabase
      .from("product")
      .select("id,template_id,template:product_template!inner(name,kind,sections:product_section(id,name,ordinal))")
      .eq("project_id", projectId)
      .eq("template.kind", "report"),
  ]);

  // Every code of this interview → the active code it now counts as.
  const current = new Map((allCodes ?? []).map((c) => [c.id, c.merged_into_id ?? c.id]));
  const codes = evidence.codes.filter((c) => c.transcriptId === iv.id);
  const here = new Set(codes.map((c) => c.id));
  const resolve = (ids: string[]) => [...new Set(ids.map((id) => current.get(id)).filter((id): id is string => !!id && here.has(id)))];

  const who = new Map((speakers ?? []).map((s) => [s.name, s]));

  type NoteRow = { id: string; template_id: string; template: { name: string; sections: Section[] } };
  const noteList = ((notes ?? []) as unknown as NoteRow[]).sort((a, b) => a.template.name.localeCompare(b.template.name));
  const note = noteList.find((n) => n.template_id === noteTemplateId) ?? noteList[0];

  type MemoRow = { id: string; template_id: string; template: { name: string; sections: Section[] } };
  const memoList = ((memos ?? []) as unknown as MemoRow[]).sort((a, b) => a.template.name.localeCompare(b.template.name));
  const memo = memoList.find((m) => m.template_id === memoTemplateId) ?? memoList[0];

  const [{ data: noteItems }, { data: memoItems }] = await Promise.all([
    note
      ? supabase.from("note_item").select("id,section_id,ordinal,text,codes:note_item_code(code_id)").eq("note_id", note.id).order("ordinal")
      : Promise.resolve({ data: [] as never[] }),
    memo
      ? supabase
          .from("product_item")
          .select("id,section_id,ordinal,text,themes:product_item_theme(theme_id),codes:product_item_code(code_id)")
          .eq("product_id", memo.id)
          .order("ordinal")
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const themes = (themeRows ?? [])
    .filter((t) => withProposed || t.status === "confirmed")
    .map((t) => ({
      id: t.id,
      ref: t.ref,
      title: t.title,
      proposed: t.status !== "confirmed",
      codeIds: resolve((t.codes ?? []).map((c: { code_id: string }) => c.code_id)),
    }))
    .filter((t) => t.codeIds.length)
    .sort((a, b) => b.codeIds.length - a.codeIds.length);
  const shownThemes = new Set(themes.map((t) => t.id));

  const noteSections = [...(note?.template.sections ?? [])].sort(byOrdinal).map((s) => ({
    id: s.id,
    name: s.name,
    items: (noteItems ?? [])
      .filter((i) => i.section_id === s.id)
      .map((i) => ({ id: i.id, text: i.text, codeIds: resolve((i.codes ?? []).map((c: { code_id: string }) => c.code_id)) })),
  }));

  let hiddenParagraphs = 0;
  const memoSections = [...(memo?.template.sections ?? [])].sort(byOrdinal).map((s) => ({
    id: s.id,
    name: s.name,
    paragraphs: (memoItems ?? [])
      .filter((i) => i.section_id === s.id)
      .map((i) => ({
        id: i.id,
        text: i.text,
        themeIds: (i.themes ?? []).map((t: { theme_id: string }) => t.theme_id).filter((id: string) => shownThemes.has(id)),
        codeIds: resolve((i.codes ?? []).map((c: { code_id: string }) => c.code_id)),
      }))
      .filter((p) => {
        const keep = p.themeIds.length > 0 || p.codeIds.length > 0;
        if (!keep) hiddenParagraphs++;
        return keep;
      }),
  }));

  const edges: Edge[] = [];
  for (const c of codes) for (let n = c.line_start; n <= c.line_end; n++) edges.push({ a: `ln-${n}`, b: `cd-${c.id}` });
  for (const s of noteSections) for (const i of s.items) for (const c of i.codeIds) edges.push({ a: `cd-${c}`, b: `it-${i.id}` });
  for (const t of themes) for (const c of t.codeIds) edges.push({ a: `cd-${c}`, b: `th-${t.id}` });
  for (const s of memoSections)
    for (const p of s.paragraphs) {
      for (const t of p.themeIds) edges.push({ a: `th-${t}`, b: `pa-${p.id}` });
      for (const c of p.codeIds) edges.push({ a: `cd-${c}`, b: `pa-${p.id}` });
    }

  const coded = new Set(codes.flatMap((c) => Array.from({ length: c.line_end - c.line_start + 1 }, (_, k) => c.line_start + k)));
  const text = new Map(lines.map((l) => [l.n, l]));
  const data: ChainData = {
    interview: { id: iv.id, key: iv.key, title: iv.title, participant: iv.participant, lineCount: lines.length },
    interviews: evidence.interviews.map((i) => ({ id: i.id, label: `${i.key} · ${i.title}` })),
    notes: noteList.map((n) => ({ id: n.template_id, name: n.template.name })),
    noteTemplateId: note?.template_id ?? null,
    memos: memoList.map((m) => ({ id: m.template_id, name: m.template.name })),
    memoTemplateId: memo?.template_id ?? null,
    lines: foldLines(
      lines.map((l) => l.n),
      codes.map((c) => ({ start: c.line_start, end: c.line_end })),
    ).map((r) => {
      if (r.kind === "gap") return r;
      const l = text.get(r.n)!;
      const s = who.get(l.speaker);
      return { kind: "line" as const, n: r.n, speaker: s?.display_name ?? l.speaker, participant: s?.role === "participant", text: l.text, coded: coded.has(r.n) };
    }),
    codes: codes.map((c) => ({ id: c.id, ref: c.ref, type: c.type, label: c.label, start: c.line_start, end: c.line_end })),
    noteSections,
    themes,
    memoSections,
    hiddenParagraphs,
    edges,
  };

  return <ChainBoard projectId={projectId} withProposed={withProposed} data={data} />;
}
