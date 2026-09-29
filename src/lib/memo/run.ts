import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emptyUsage, structuredCall, type Usage } from "@/lib/claude/call";
import type { ParagraphProposal } from "./gate";
import { MEMO_SYSTEM, memoMessage, type MemoCode, type MemoSection, type MemoTheme } from "./prompt";

/** The answer's shape for a template with `count` sections: a headline, and
 *  paragraphs keyed to the template's own sections. */
export const memoResponseSchema = (count: number) =>
  z.object({
    title: z.string(),
    paragraphs: z.array(
      z.object({
        section: z.enum(Array.from({ length: Math.max(count, 1) }, (_, i) => `S${i + 1}`) as [string, ...string[]]),
        text: z.string(),
        themes: z.array(z.string()),
        codes: z.array(z.string()),
      }),
    ),
  });

/** Write the memo. Returns Claude's headline and paragraphs unchecked;
 *  gateParagraphs() and the database decide what's kept. */
export async function writeMemo(
  ctx: { project: string; client: string | null; interviews: number; templateName: string },
  sections: MemoSection[],
  themes: MemoTheme[],
  codes: MemoCode[],
  client: Anthropic = new Anthropic(),
): Promise<{ title: string; proposals: ParagraphProposal[]; usage: Usage }> {
  const usage = emptyUsage();
  const read = await structuredCall(client, {
    system: MEMO_SYSTEM,
    user: memoMessage(ctx, sections, themes, codes),
    schema: memoResponseSchema(sections.length),
    what: "write this memo",
    usage,
  });
  return { title: read.title.trim(), proposals: read.paragraphs, usage };
}
