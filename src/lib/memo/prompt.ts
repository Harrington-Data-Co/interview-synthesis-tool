/** Bump when the instructions or the output shape change. */
export const MEMO_PROMPT_VERSION = "memo-v1";

export type MemoSection = {
  id: string;
  name: string;
  /** "themes" and/or code types; empty means anything. */
  requires: string[];
  note: string | null;
};

export type MemoTheme = {
  id: string;
  ref: string; // TH-3
  title: string;
  description: string | null;
  codeIds: string[];
  interviews: number;
};

export type MemoCode = {
  id: string;
  key: string; // I3:PAIN-03
  type: string;
  label: string;
  verbatim: string;
};

export const MEMO_SYSTEM = `You are writing a findings memo for Harrington Data Co, a data consultancy, to give to its client. It reports what a set of discovery interviews found. The findings are the confirmed themes: each is a finding the team has already checked against the interviews, with the codes — participants' own words — that support it.

How to write it:
1. Write for the client: plain, direct professional prose. Short paragraphs of two to four sentences. No jargon about coding or themes; the reader cares what was found.
2. Everything you say must be supported by what you cite. Report what the interviews showed; don't add recommendations, causes, numbers or facts the themes and codes don't support. Say how widely something held when it matters ("in five of the six interviews").
3. Every paragraph cites the themes (by ref, for example TH-3) and codes (by key, for example I3:PAIN-03) it rests on — at least one. Only refs and keys from the lists.
4. Follow each section's guidance. A section lists what it fills from: "themes" means cite themes (and, if you like, the codes within them); code types mean cite codes of those types. A section marked "anything" takes either.
5. Order matters: lead with what's most important and best supported.
6. The headline is one sentence stating the single most important finding.
7. Name each paragraph's section by its key alone — "S2", not "S2. Findings".`;

/** Sections, confirmed themes (with their codes) and the codes other
 *  sections can draw on, as Claude reads them. */
export function memoMessage(
  ctx: { project: string; client: string | null; interviews: number; templateName: string },
  sections: MemoSection[],
  themes: MemoTheme[],
  codes: MemoCode[],
): string {
  const byId = new Map(codes.map((c) => [c.id, c]));
  const sectionList = sections
    .map(
      (s, i) =>
        `S${i + 1}. ${s.name} — fills from ${s.requires.length ? s.requires.join(", ") : "anything"}${s.note ? `\n    ${s.note}` : ""}`,
    )
    .join("\n");
  const themeList = themes
    .map((t) => {
      const cs = t.codeIds.map((id) => byId.get(id)).filter((c): c is MemoCode => !!c);
      const lines = cs.map((c) => `    ${c.key} [${c.type}] ${c.label} — “${c.verbatim}”`).join("\n");
      return `${t.ref}. ${t.title} (${cs.length} codes, ${t.interviews} of the interviews)${t.description ? `\n    ${t.description}` : ""}\n${lines}`;
    })
    .join("\n\n");
  // Codes outside any theme, for sections that fill from code types.
  const inThemes = new Set(themes.flatMap((t) => t.codeIds));
  const others = codes.filter((c) => !inThemes.has(c.id));
  const otherList = others.map((c) => `${c.key} [${c.type}] ${c.label} — “${c.verbatim}”`).join("\n");

  return [
    `Project: ${ctx.project}${ctx.client ? ` for ${ctx.client}` : ""} · ${ctx.interviews} interviews`,
    `Memo template: ${ctx.templateName}`,
    `<sections>\n${sectionList}\n</sections>`,
    `<confirmed_themes>\n${themeList || "(none)"}\n</confirmed_themes>`,
    `<other_codes>\n${otherList || "(none)"}\n</other_codes>`,
  ].join("\n\n");
}
