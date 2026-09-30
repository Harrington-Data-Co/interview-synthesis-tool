import type { MemoCode, MemoSection, MemoTheme } from "@/lib/memo/prompt";
import { memoMessage } from "@/lib/memo/prompt";

/** Bump when the instructions or the output shape change. */
export const DECK_PROMPT_VERSION = "deck-v1";

export const DECK_SYSTEM = `You are writing a slide deck for Harrington Data Co, a data consultancy, to present to its client. It reports what a set of discovery interviews found. The findings are the confirmed themes: each is a finding the team has already checked against the interviews, with the codes — participants' own words — that support it.

How to write it:
1. Every slide's title is an assertion: one full sentence stating its takeaway ("Quarterly reporting is rebuilt by hand from three systems"), never a topic label ("Reporting"). Under 15 words.
2. Layouts. "finding": the title plus two to four short bullets on what the interviews showed. "quote": a participant's words carry the slide; the title frames them and bullets are usually empty. "statement": one big sentence (the title) with no bullets — for the headline and section openers.
3. Bullets are short phrases, not paragraphs: under 14 words each, at most four. Say how widely something held when it matters ("5 of 6 interviews").
4. A slide may feature one quote: give the key of a code it cites (for example I3:PAIN-03). The app shows that code's words exactly as spoken, so pick one that is short, vivid and representative. Leave it empty when no quote earns its place.
5. Everything on a slide must be supported by what it cites. Don't add recommendations, causes, numbers or facts the themes and codes don't support.
6. Every slide cites the themes (by ref, for example TH-3) and codes (by key) it rests on — at least one. Only refs and keys from the lists.
7. Follow each section's guidance and what it fills from. A section that fills from "themes": cite themes, and optionally codes that belong to those themes. A section that fills only from code types (for example "Question"): cite only codes of those types — no themes, and no codes of other types. A section marked "anything" takes either. If a section has nothing it may cite, leave it without slides.
8. Speaker notes: one to three sentences the presenter can say — the nuance, how widely it held, a detail behind the headline.
9. The deck title is the single most important finding, as a sentence.
10. Refer to participants by role ("the CEO", "a program officer", "evaluators"), never by name: the deck may be shown beyond the people interviewed.
11. Name each slide's section by its key alone — "S2", not "S2. Findings". Put slides in the order they should be shown.`;

/** The same material the memo reads: sections, confirmed themes with their
 *  codes, and other codes for sections that fill from code types. */
export function deckMessage(
  ctx: { project: string; client: string | null; interviews: number; templateName: string },
  sections: MemoSection[],
  themes: MemoTheme[],
  codes: MemoCode[],
): string {
  return memoMessage(ctx, sections, themes, codes).replace("Memo template:", "Deck template:");
}
