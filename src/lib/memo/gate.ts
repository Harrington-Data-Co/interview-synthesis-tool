import type { MemoCode, MemoSection, MemoTheme } from "./prompt";

export type ParagraphProposal = { section: string; text: string; themes: string[]; codes: string[] };
export type ParagraphRow = { section_id: string; text: string; theme_ids: string[]; code_ids: string[] };
export type ParagraphRejection = { proposal: ParagraphProposal; reason: string };

/** Resolve a memo's sections (S1…), themes (TH-3) and codes (I3:PAIN-03) to
 *  ids, and apply the rules the database applies again for Claude's
 *  paragraphs: at least one citation; nothing unknown (the paragraph's
 *  wording may rest on it, so it's rejected whole rather than trimmed);
 *  themes only where a section fills from themes; codes only of the
 *  section's types or within a cited theme. */
export function gateParagraphs(
  proposals: ParagraphProposal[],
  sections: MemoSection[],
  themes: MemoTheme[],
  codes: MemoCode[],
): { accepted: ParagraphRow[]; rejected: ParagraphRejection[] } {
  const byKey = new Map(sections.map((s, i) => [`S${i + 1}`, s]));
  const byName = new Map(sections.map((s) => [s.name.trim().toLowerCase(), s]));
  const sectionFor = (label: string) => {
    const t = label.trim();
    const key = t.match(/^S(\d+)\b/i);
    return key ? byKey.get(`S${Number(key[1])}`) : byName.get(t.toLowerCase());
  };
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");
  const themeByRef = new Map(themes.map((t) => [norm(t.ref), t]));
  const codeByKey = new Map(codes.map((c) => [norm(c.key), c]));
  const accepted: ParagraphRow[] = [];
  const rejected: ParagraphRejection[] = [];

  for (const p of proposals) {
    const reject = (reason: string) => rejected.push({ proposal: p, reason });
    const section = sectionFor(p.section);
    const text = p.text.replace(/\s+/g, " ").trim();
    const themeRefs = [...new Set(p.themes.map(norm))];
    const codeKeys = [...new Set(p.codes.map(norm))];
    const unknown = [...themeRefs.filter((r) => !themeByRef.has(r)), ...codeKeys.filter((k) => !codeByKey.has(k))];
    const cited = themeRefs.map((r) => themeByRef.get(r)).filter((t): t is MemoTheme => !!t);
    const citedCodes = codeKeys.map((k) => codeByKey.get(k)).filter((c): c is MemoCode => !!c);
    const req = section?.requires ?? [];
    const inCitedThemes = new Set(cited.flatMap((t) => t.codeIds));
    const offTypeCodes = req.length
      ? citedCodes.filter((c) => !req.includes(c.type) && !inCitedThemes.has(c.id))
      : [];

    if (!section) reject(`"${p.section}" isn't one of the template's sections.`);
    else if (!text) reject("The paragraph has no text.");
    else if (!themeRefs.length && !codeKeys.length) reject("The paragraph cites nothing.");
    else if (unknown.length)
      reject(`${unknown.join(", ")} ${unknown.length === 1 ? "isn't a confirmed theme or code" : "aren't confirmed themes or codes"} in this project.`);
    else if (cited.length && req.length && !req.includes("themes")) reject(`${section.name} doesn't fill from themes.`);
    else if (offTypeCodes.length)
      reject(`${section.name} fills from ${req.join(", ")}; ${offTypeCodes.map((c) => `${c.key} is a ${c.type}`).join(", ")} outside the themes cited.`);
    else accepted.push({ section_id: section.id, text, theme_ids: cited.map((t) => t.id), code_ids: citedCodes.map((c) => c.id) });
  }
  return { accepted, rejected };
}
