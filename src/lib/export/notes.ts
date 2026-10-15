import type { Block } from "./blocks";

export type NoteExport = {
  transcript: string;
  project: string | null;
  client: string | null;
  template: string;
  sections: { name: string; items: { text: string; codeIds: string[] }[] }[];
  codes: Map<string, { ref: string; label: string; verbatim: string; line_start: number; line_end: number }>;
};

const lines = (c: { line_start: number; line_end: number }) => (c.line_start === c.line_end ? `L${c.line_start}` : `L${c.line_start}–${c.line_end}`);

type Sections = NoteExport["sections"];
type Codes = NoteExport["codes"];

/** A note's sections in order, each item with the evidence it cites — code,
 *  line address and the participant's words. `from` names the interview when
 *  several share one document, so identical-looking citations stay apart. */
function sectionBlocks(sections: Sections, codes: Codes, level: 2 | 3 | 4, from?: string): Block[] {
  const blocks: Block[] = [];
  for (const s of sections) {
    if (!s.items.length) continue;
    blocks.push({ kind: "heading", text: s.name, level });
    for (const it of s.items) {
      blocks.push({
        kind: "bullet",
        text: it.text,
        cites: it.codeIds.flatMap((id) => {
          const c = codes.get(id);
          return c ? [`${from ? `${from} · ` : ""}${c.ref} (${lines(c)}): “${c.verbatim}”`] : [];
        }),
      });
    }
  }
  return blocks;
}

/** One interview's notes. */
export function noteBlocks(n: NoteExport): Block[] {
  return [
    { kind: "title", text: n.transcript },
    { kind: "meta", text: [n.template, n.project, n.client].filter(Boolean).join(" · ") },
    ...sectionBlocks(n.sections, n.codes, 2),
  ];
}

export type ProjectNotesExport = {
  project: string;
  client: string | null;
  interviews: {
    title: string;
    /** Participant, organization, date — whatever is known. */
    meta: string;
    notes: { template: string; sections: Sections }[];
    codes: Codes;
  }[];
};

/** Every interview's notes in one document: a heading per interview, then its
 *  notes. Template names appear only where an interview has more than one. */
export function projectNotesBlocks(p: ProjectNotesExport): Block[] {
  const blocks: Block[] = [
    { kind: "title", text: `${p.project} — Interview notes` },
    { kind: "meta", text: [p.client, `${p.interviews.length} ${p.interviews.length === 1 ? "interview" : "interviews"}`].filter(Boolean).join(" · ") },
  ];
  for (const iv of p.interviews) {
    blocks.push({ kind: "heading", text: iv.title, level: 2 });
    if (iv.meta) blocks.push({ kind: "meta", text: iv.meta });
    const several = iv.notes.length > 1;
    for (const n of iv.notes) {
      if (several) blocks.push({ kind: "heading", text: n.template, level: 3 });
      blocks.push(...sectionBlocks(n.sections, iv.codes, several ? 4 : 3, iv.title));
    }
  }
  return blocks;
}
