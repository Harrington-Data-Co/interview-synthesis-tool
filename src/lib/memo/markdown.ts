/** A memo as Markdown: headline, sections, paragraphs, and its citations as
 *  numbered footnotes — each theme by its finding, each code by interview and
 *  the participant's words — so the evidence travels with the document. */
export function memoMarkdown(memo: {
  title: string | null;
  project: string;
  client: string | null;
  sections: { name: string; paragraphs: { text: string; themes: string[]; codes: string[] }[] }[];
  themes: Map<string, { ref: string; title: string }>;
  codes: Map<string, { key: string; participant: string | null; verbatim: string }>;
}): string {
  const notes: string[] = [];
  const noteFor = new Map<string, number>();
  const cite = (id: string, text: string) => {
    if (!noteFor.has(id)) {
      notes.push(text);
      noteFor.set(id, notes.length);
    }
    return `[^${noteFor.get(id)}]`;
  };

  const out: string[] = [`# ${memo.title ?? "Findings memo"}`, "", `*${memo.project}${memo.client ? ` · ${memo.client}` : ""}*`, ""];
  for (const s of memo.sections) {
    if (!s.paragraphs.length) continue;
    out.push(`## ${s.name}`, "");
    for (const p of s.paragraphs) {
      const marks = [
        ...p.themes.map((id) => {
          const t = memo.themes.get(id);
          return t ? cite(id, `${t.ref} — ${t.title}`) : "";
        }),
        ...p.codes.map((id) => {
          const c = memo.codes.get(id);
          return c ? cite(id, `${c.key}${c.participant ? `, ${c.participant}` : ""}: “${c.verbatim}”`) : "";
        }),
      ].join("");
      out.push(`${p.text}${marks}`, "");
    }
  }
  if (notes.length) {
    out.push("---", "");
    notes.forEach((n, i) => out.push(`[^${i + 1}]: ${n}`));
    out.push("");
  }
  return out.join("\n");
}
