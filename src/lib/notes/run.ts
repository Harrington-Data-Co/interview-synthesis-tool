import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emptyUsage, structuredCall, type Usage } from "@/lib/claude/call";
import type { ItemProposal } from "./gate";
import { NOTE_SYSTEM, noteMessage, type NoteCode, type NoteSection } from "./prompt";

/** The answer's shape for a template with `count` sections. The section is
 *  an enum of the template's own keys, so structured output can't return a
 *  label the note can't place. */
export const noteResponseSchema = (count: number) =>
  z.object({
    items: z.array(
      z.object({
        section: z.enum(Array.from({ length: Math.max(count, 1) }, (_, i) => `S${i + 1}`) as [string, ...string[]]),
        text: z.string(),
        refs: z.array(z.string()),
      }),
    ),
  });

/** One note: the interview's codes arranged into the template's sections.
 *  Returns Claude's items unchecked; gateItems() and the database decide
 *  what's kept. Throws ClaudeError (with usage) when there's no usable answer. */
export async function writeNote(
  ctx: { title: string; participant: string | null; templateName: string; templateScope: string | null },
  sections: NoteSection[],
  codes: NoteCode[],
  client: Anthropic = new Anthropic(),
): Promise<{ proposals: ItemProposal[]; usage: Usage }> {
  const usage = emptyUsage();
  const read = await structuredCall(client, {
    system: NOTE_SYSTEM,
    user: noteMessage(ctx, sections, codes),
    schema: noteResponseSchema(sections.length),
    what: "write this note",
    usage,
  });
  return { proposals: read.items, usage };
}
