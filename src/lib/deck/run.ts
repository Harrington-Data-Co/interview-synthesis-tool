import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emptyUsage, structuredCall, type Usage } from "@/lib/claude/call";
import type { MemoCode, MemoSection, MemoTheme } from "@/lib/memo/prompt";
import type { SlideProposal } from "./gate";
import { DECK_SYSTEM, deckMessage } from "./prompt";

/** The answer's shape for a template with `count` sections. */
export const deckResponseSchema = (count: number) =>
  z.object({
    title: z.string(),
    slides: z.array(
      z.object({
        section: z.enum(Array.from({ length: Math.max(count, 1) }, (_, i) => `S${i + 1}`) as [string, ...string[]]),
        layout: z.enum(["finding", "quote", "statement"]),
        title: z.string(),
        bullets: z.array(z.string()),
        quote: z.string(),
        notes: z.string(),
        themes: z.array(z.string()),
        codes: z.array(z.string()),
      }),
    ),
  });

/** Write the deck. Returns Claude's title and slides unchecked; gateSlides()
 *  and the database decide what's kept. */
export async function writeDeck(
  ctx: { project: string; client: string | null; interviews: number; templateName: string },
  sections: MemoSection[],
  themes: MemoTheme[],
  codes: MemoCode[],
  client: Anthropic = new Anthropic(),
): Promise<{ title: string; proposals: SlideProposal[]; usage: Usage }> {
  const usage = emptyUsage();
  const read = await structuredCall(client, {
    system: DECK_SYSTEM,
    user: deckMessage(ctx, sections, themes, codes),
    schema: deckResponseSchema(sections.length),
    what: "write this deck",
    usage,
  });
  return { title: read.title.trim(), proposals: read.slides, usage };
}
