/** Bump when the instructions or the output shape change. */
export const NOTE_PROMPT_VERSION = "note-v2";

export type NoteSection = {
  id: string;
  name: string;
  /** Code types Claude may cite here; empty means any. */
  requires: string[];
  note: string | null;
};

export type NoteCode = {
  id: string;
  ref: string;
  type: string;
  label: string;
  verbatim: string;
  note: string | null;
  line_start: number;
  line_end: number;
};

export const NOTE_SYSTEM = `You are writing an interview note for Harrington Data Co, a data consultancy. The interview has already been coded: each code is a short finding with the participant's own words as evidence. Your job is to arrange those codes into the sections of a note template, so a reader can take in the interview in a few minutes and trust every line of it.

The note is a rearrangement, not a rewrite:
1. Each item is one or two plain sentences restating what its codes say, in the third person ("They rebuild the enrollment roster by hand each month."). Add nothing the codes don't say: no causes, recommendations, speculation, or facts from outside the interview.
2. Every item cites, by ref (for example PAIN-03), every code it rests on — at least one. Cite only refs from the code list.
3. Put each item in the section whose purpose it fits. A section lists the code types it takes; cite only codes of those types there. A section marked "any" takes any type.
4. When several codes make the same point, write one item citing all of them rather than repeating yourself.
5. Place every code somewhere it fits. A code that fits no section may be left out; don't force it.
6. Order items within a section so they read well — a process in the order it happens, the most important point first otherwise. Leave a section empty if nothing belongs in it.

Name each item's section by its key alone — "S2", not "S2. How the work happens today".`;

/** The template and the codes, as Claude reads them. Sections are keyed S1,
 *  S2… so the answer can name them without ids. */
export function noteMessage(
  ctx: { title: string; participant: string | null; templateName: string; templateScope: string | null },
  sections: NoteSection[],
  codes: NoteCode[],
): string {
  const header = [
    `Interview: ${ctx.title}`,
    ctx.participant && `Participant: ${ctx.participant}`,
    `Template: ${ctx.templateName}${ctx.templateScope ? ` — ${ctx.templateScope}` : ""}`,
  ].filter(Boolean);

  const sectionList = sections
    .map(
      (s, i) =>
        `S${i + 1}. ${s.name} — takes ${s.requires.length ? s.requires.join(", ") : "any"} codes${s.note ? `\n    ${s.note}` : ""}`,
    )
    .join("\n");

  const codeList = codes
    .map((c) => {
      const lines = c.line_start === c.line_end ? `L${c.line_start}` : `L${c.line_start}–${c.line_end}`;
      return `${c.ref} [${c.type}] ${c.label} — “${c.verbatim}” (${lines})${c.note ? ` · ${c.note}` : ""}`;
    })
    .join("\n");

  return `${header.join("\n")}\n\n<sections>\n${sectionList}\n</sections>\n\n<codes>\n${codeList}\n</codes>`;
}
