import { createClient } from "@/lib/supabase/server";
import { NoteView } from "./NoteView";
import type { CoverageRow, NoteCodeView, NoteItemView, NoteRejectionView, NoteRunView, NoteTemplateView } from "./types";

/** Loads stage 03 for one interview: its project's templates, the note for
 *  the chosen template (items, citations, coverage, proposals awaiting
 *  review, recent runs), and the codes it can cite. */
export async function NotesStage({
  transcriptId,
  projectId,
  templateId,
  editor,
}: {
  transcriptId: string;
  projectId: string | null;
  templateId: string | undefined;
  editor: boolean;
}) {
  const supabase = await createClient();
  const [{ data: tplRows }, { data: libraryRows }, { data: noteRows }, { data: codeRows }, { data: seats }] = await Promise.all([
    projectId
      ? supabase
          .from("note_template")
          .select("id,name,scope,sections:note_section(id,ordinal,name,requires,note)")
          .eq("project_id", projectId)
          .order("name")
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("note_template").select("id,name").is("project_id", null).order("name"),
    supabase.from("note").select("id,template_id").eq("transcript_id", transcriptId),
    supabase
      .from("code")
      .select("id,ref,type,label,verbatim,line_start,line_end,merged_into_id")
      .eq("transcript_id", transcriptId)
      .order("line_start"),
    supabase.from("seat").select("user_id,name"),
  ]);
  const who = new Map((seats ?? []).map((s) => [s.user_id, s.name]));

  const templates: NoteTemplateView[] = (tplRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    sections: [...(t.sections ?? [])]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({ id: s.id, name: s.name, requires: s.requires ?? [], note: s.note })),
  }));
  const notes = noteRows ?? [];
  // The chosen template, else the first with a note, else the first.
  const template =
    templates.find((t) => t.id === templateId) ??
    templates.find((t) => notes.some((n) => n.template_id === t.id)) ??
    templates[0];
  const note = template ? notes.find((n) => n.template_id === template.id) : undefined;

  let items: NoteItemView[] = [];
  let coverage: CoverageRow[] = [];
  let rejections: NoteRejectionView[] = [];
  let runs: NoteRunView[] = [];
  if (template) {
    const { data: runRows } = await supabase
      .from("note_run")
      .select("status,started_at,started_by,accepted,rejected,cost_usd,error")
      .eq("transcript_id", transcriptId)
      .eq("template_id", template.id)
      .order("started_at", { ascending: false })
      .limit(3);
    runs = (runRows ?? []).map((r) => ({ ...r, started_by: who.get(r.started_by) ?? "someone" })) as NoteRunView[];
  }
  if (note) {
    const [{ data: itemRows }, { data: cov }, { data: rej }] = await Promise.all([
      supabase
        .from("note_item")
        .select("id,section_id,ordinal,text,origin,codes:note_item_code(code_id)")
        .eq("note_id", note.id)
        .order("ordinal"),
      supabase.rpc("note_coverage", { p_note_id: note.id }),
      supabase
        .from("note_item_rejection")
        .select("id,reason,proposal")
        .eq("note_id", note.id)
        .is("resolution", null)
        .order("created_at"),
    ]);
    const ids = (itemRows ?? []).map((i) => i.id);
    const lastEdit = new Map<string, NoteItemView["lastEdit"]>();
    if (ids.length) {
      const { data: edits } = await supabase
        .from("edit")
        .select("object_id,text,edited_by")
        .eq("object_type", "note_item")
        .eq("reverted", false)
        .not("before", "is", null)
        .not("after", "is", null)
        .in("object_id", ids)
        .order("edited_at", { ascending: false });
      for (const e of edits ?? []) {
        if (!lastEdit.has(e.object_id)) lastEdit.set(e.object_id, { text: e.text, by: who.get(e.edited_by) ?? "someone" });
      }
    }
    items = (itemRows ?? []).map((i) => ({
      id: i.id,
      sectionId: i.section_id,
      ordinal: i.ordinal,
      text: i.text,
      origin: i.origin,
      codeIds: (i.codes ?? []).map((c: { code_id: string }) => c.code_id),
      lastEdit: lastEdit.get(i.id) ?? null,
    }));
    coverage = (cov ?? []) as CoverageRow[];
    rejections = (rej ?? []) as NoteRejectionView[];
  }

  return (
    <NoteView
      transcriptId={transcriptId}
      projectId={projectId}
      editor={editor}
      templates={templates}
      library={libraryRows ?? []}
      template={template ?? null}
      noteId={note?.id ?? null}
      notedTemplateIds={notes.map((n) => n.template_id)}
      items={items}
      codes={(codeRows ?? []) as NoteCodeView[]}
      coverage={coverage}
      rejections={rejections}
      runs={runs}
    />
  );
}
