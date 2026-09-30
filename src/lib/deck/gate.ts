import { gateParagraphs } from "@/lib/memo/gate";
import type { MemoCode, MemoSection, MemoTheme } from "@/lib/memo/prompt";

export type SlideLayout = "finding" | "quote" | "statement";
export type SlideProposal = {
  section: string;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  quote: string;
  notes: string;
  themes: string[];
  codes: string[];
};
export type SlideRow = {
  section_id: string;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  quote_code_id: string | null;
  notes: string | null;
  theme_ids: string[];
  code_ids: string[];
};
export type SlideRejection = { proposal: SlideProposal; reason: string };

export const MAX_BULLETS = 6;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/** A slide's section and citations are held to the memo's rules (see
 *  gateParagraphs), with its title standing in for a paragraph's text. On
 *  top: a quote must be a known code, and counts as cited (the slide rests
 *  on it); bullets are trimmed and capped. */
export function gateSlides(
  proposals: SlideProposal[],
  sections: MemoSection[],
  themes: MemoTheme[],
  codes: MemoCode[],
): { accepted: SlideRow[]; rejected: SlideRejection[] } {
  const codeByKey = new Map(codes.map((c) => [norm(c.key), c]));
  const accepted: SlideRow[] = [];
  const rejected: SlideRejection[] = [];
  for (const p of proposals) {
    const quoteKey = clean(p.quote) ? norm(p.quote) : "";
    const quote = quoteKey ? codeByKey.get(quoteKey) : undefined;
    if (quoteKey && !quote) {
      rejected.push({ proposal: p, reason: `The quote ${p.quote} isn't a code in this project.` });
      continue;
    }
    const cites = quoteKey && !p.codes.some((k) => norm(k) === quoteKey) ? [...p.codes, p.quote] : p.codes;
    const { accepted: ok, rejected: no } = gateParagraphs([{ section: p.section, text: p.title, themes: p.themes, codes: cites }], sections, themes, codes);
    if (no.length) {
      rejected.push({ proposal: p, reason: no[0].reason.replace("The paragraph has no text.", "The slide has no title.").replace("The paragraph cites nothing.", "The slide cites nothing.") });
      continue;
    }
    const row = ok[0];
    accepted.push({
      section_id: row.section_id,
      layout: p.layout,
      title: row.text,
      bullets: p.bullets.map(clean).filter(Boolean).slice(0, MAX_BULLETS),
      quote_code_id: quote?.id ?? null,
      notes: clean(p.notes) || null,
      theme_ids: row.theme_ids,
      code_ids: row.code_ids,
    });
  }
  return { accepted, rejected };
}
