import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { chunkLines } from "./chunks";
import type { Proposal } from "./gate";
import {
  CLAUDE_CODE_TYPES,
  EFFORT,
  MODEL,
  SYSTEM,
  transcriptMessage,
  type CodingLine,
  type TranscriptContext,
} from "./prompt";

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

export type Usage = {
  served_by: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
};

/** $ per million tokens, input / output. A fallback can answer on another
 *  model; its price is used when known, and cost is left unknown otherwise. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
};

/** Claude declined, answered past its limit, or answered in the wrong shape.
 *  The message is written for the person who pressed Code. */
export class CodingError extends Error {
  name = "CodingError";
  constructor(
    message: string,
    public usage: Usage,
  ) {
    super(message);
  }
}

function addUsage(total: Usage, msg: { model: string; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } }) {
  const input =
    msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
  total.input_tokens += input;
  total.output_tokens += msg.usage.output_tokens;
  total.served_by = total.served_by && total.served_by !== msg.model ? `${total.served_by}, ${msg.model}` : msg.model;
  const price = PRICES[msg.model];
  total.cost_usd =
    price && total.cost_usd !== null
      ? total.cost_usd + (input * price[0] + msg.usage.output_tokens * price[1]) / 1_000_000
      : null;
}

/** Parse one response's text into proposals, or explain why it can't be. */
export function readResponse(msg: {
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content: { type: string; text?: string }[];
}): Proposal[] | string {
  if (msg.stop_reason === "refusal") {
    const why = msg.stop_details?.category ? ` (${msg.stop_details.category})` : "";
    return `Claude declined to code this transcript${why}. Nothing was saved.`;
  }
  if (msg.stop_reason === "max_tokens") {
    return "Claude's answer ran past its length limit before finishing. Nothing was saved.";
  }
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return "Claude's answer wasn't the expected format. Nothing was saved.";
  }
  const parsed = ResponseSchema.safeParse(json);
  return parsed.success ? parsed.data.codes : "Claude's answer wasn't the expected format. Nothing was saved.";
}

/** One coding pass over a transcript: every chunk in turn (usually one),
 *  streamed so a long answer can't time out the HTTP request. Returns what
 *  Claude proposed, unchecked — the gate and the database decide what's kept. */
export async function codeTranscript(
  ctx: TranscriptContext,
  lines: CodingLine[],
  client: Anthropic = new Anthropic(),
): Promise<{ proposals: Proposal[]; usage: Usage }> {
  const usage: Usage = { served_by: null, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  const chunks = chunkLines(lines);
  const proposals: Proposal[] = [];

  for (const [i, chunk] of chunks.entries()) {
    const part = chunks.length > 1 ? { index: i + 1, total: chunks.length, codeFrom: chunk.codeFrom } : undefined;
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64_000,
      output_config: { effort: EFFORT, format: betaZodOutputFormat(ResponseSchema) },
      // A classifier false positive retries on the model Anthropic
      // recommends for it, rather than failing the pass.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: transcriptMessage(ctx, chunk.lines, part) }],
    });
    const msg = await stream.finalMessage();
    addUsage(usage, msg);

    const read = readResponse(msg);
    if (typeof read === "string") throw new CodingError(read, usage);
    // Codes starting in the overlap belong to the previous chunk.
    proposals.push(...read.filter((p) => p.line_start >= chunk.codeFrom));
  }
  return { proposals, usage };
}
