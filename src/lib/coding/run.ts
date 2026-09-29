import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emptyUsage, readStructured, structuredCall, type Usage } from "@/lib/claude/call";
import { chunkLines } from "./chunks";
import type { Proposal } from "./gate";
import { CLAUDE_CODE_TYPES, SYSTEM, transcriptMessage, type CodingLine, type TranscriptContext } from "./prompt";

export type { Usage } from "@/lib/claude/call";
export { ClaudeError as CodingError } from "@/lib/claude/call";

export const ResponseSchema = z.object({
  codes: z.array(
    z.object({
      line_start: z.number().int(),
      line_end: z.number().int(),
      type: z.enum(CLAUDE_CODE_TYPES),
      label: z.string(),
      verbatim: z.string(),
      note: z.string(),
    }),
  ),
});

const WHAT = "code this transcript";

/** Parse one coding response into proposals, or explain why it can't be. */
export function readResponse(msg: Parameters<typeof readStructured>[0]): Proposal[] | string {
  const read = readStructured(msg, ResponseSchema, WHAT);
  return typeof read === "string" ? read : read.codes;
}

/** One coding pass over a transcript: every chunk in turn (usually one).
 *  Returns what Claude proposed, unchecked — the gate and the database decide
 *  what's kept. Throws ClaudeError (as CodingError) with usage on failure. */
export async function codeTranscript(
  ctx: TranscriptContext,
  lines: CodingLine[],
  client: Anthropic = new Anthropic(),
): Promise<{ proposals: Proposal[]; usage: Usage }> {
  const usage = emptyUsage();
  const chunks = chunkLines(lines);
  const proposals: Proposal[] = [];

  for (const [i, chunk] of chunks.entries()) {
    const part = chunks.length > 1 ? { index: i + 1, total: chunks.length, codeFrom: chunk.codeFrom } : undefined;
    const read = await structuredCall(client, {
      system: SYSTEM,
      user: transcriptMessage(ctx, chunk.lines, part),
      schema: ResponseSchema,
      what: WHAT,
      usage,
    });
    // Codes starting in the overlap belong to the previous chunk.
    proposals.push(...read.codes.filter((p) => p.line_start >= chunk.codeFrom));
  }
  return { proposals, usage };
}
