import { Document, HeadingLevel, Packer, Paragraph, TextRun, type ParagraphChild } from "docx";

/** A document as a short list of blocks, so one builder serves Markdown and
 *  Word and the two can't drift apart. */
export type Block =
  | { kind: "title"; text: string }
  | { kind: "meta"; text: string }
  | { kind: "heading"; text: string; level?: 2 | 3 | 4 }
  | { kind: "para"; text: string }
  | { kind: "bullet"; text: string; cites?: string[] }
  | { kind: "quote"; text: string; by?: string };

const LEVELS = { 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 } as const;

/** Markdown: bullets can carry citations, which become numbered footnotes
 *  after a rule — the same shape the memo export uses. */
export function blocksMarkdown(blocks: Block[]): string {
  const notes: string[] = [];
  const noteFor = new Map<string, number>();
  const cite = (text: string) => {
    if (!noteFor.has(text)) {
      notes.push(text);
      noteFor.set(text, notes.length);
    }
    return `[^${noteFor.get(text)}]`;
  };
  const out: string[] = [];
  let inList = false;
  for (const b of blocks) {
    // A list is closed by a blank line before whatever follows it.
    if (inList && b.kind !== "bullet") out.push("");
    inList = b.kind === "bullet";
    if (b.kind === "title") out.push(`# ${b.text}`, "");
    else if (b.kind === "meta") out.push(`*${b.text}*`, "");
    else if (b.kind === "heading") out.push(`${"#".repeat(b.level ?? 2)} ${b.text}`, "");
    else if (b.kind === "para") out.push(b.text, "");
    else if (b.kind === "bullet") out.push(`- ${b.text}${(b.cites ?? []).map(cite).join("")}`);
    else out.push(`> “${b.text}”${b.by ? ` — ${b.by}` : ""}`, "");
  }
  const md = out.join("\n");
  if (!notes.length) return md.trimEnd() + "\n";
  return `${md.trimEnd()}\n\n---\n\n${notes.map((n, i) => `[^${i + 1}]: ${n}`).join("\n")}\n`;
}

/** Word: real Heading/List styles so the file edits like one someone typed.
 *  Citations are listed under each bullet in small grey text (Word footnotes
 *  need more machinery than a reading copy is worth). */
export async function blocksDocx(blocks: Block[], title: string, creator: string): Promise<Uint8Array> {
  const grey = "6B6B6B";
  const children: Paragraph[] = [];
  for (const b of blocks) {
    if (b.kind === "title" || b.kind === "heading") {
      children.push(
        new Paragraph({
          text: b.text,
          heading: b.kind === "title" ? HeadingLevel.TITLE : LEVELS[b.level ?? 2],
          spacing: { before: b.kind === "heading" ? 280 : 0, after: 120 },
        }),
      );
    } else if (b.kind === "meta") {
      children.push(new Paragraph({ children: [new TextRun({ text: b.text, italics: true, color: grey })], spacing: { after: 200 } }));
    } else if (b.kind === "para") {
      children.push(new Paragraph({ text: b.text, spacing: { after: 160 } }));
    } else if (b.kind === "bullet") {
      const runs: ParagraphChild[] = [new TextRun(b.text)];
      for (const c of b.cites ?? []) runs.push(new TextRun({ text: c, break: 1, size: 18, color: grey }));
      children.push(new Paragraph({ children: runs, bullet: { level: 0 }, spacing: { after: 100 } }));
    } else {
      const runs: ParagraphChild[] = [new TextRun({ text: `“${b.text}”`, italics: true })];
      if (b.by) runs.push(new TextRun({ text: ` — ${b.by}`, color: grey }));
      children.push(new Paragraph({ children: runs, indent: { left: 360 }, spacing: { after: 160 } }));
    }
  }
  const doc = new Document({ title, creator, sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
