import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/** The model and effort every pass in the tool uses. */
export const MODEL = "claude-opus-5-5";
export const EFFORT = "high" as const;

export type Usage = {
  served_by: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
};

export const emptyUsage = (): Usage => ({ served_by: null, input_tokens: 0, output_tokens: 0, cost_usd: 0 });

/** $ per million tokens, input / output. A fallback can answer on another
 *  model; its price is used when known, and cost is left unknown otherwise. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
};

/** Claude declined, answered past its limit, or answered in the wrong shape.
 *  The message is written for the person who pressed the button. */
export class ClaudeError extends Error {
  name = "ClaudeError";
  constructor(
    message: string,
    public usage: Usage,
  ) {
    super(message);
  }
}

type Msg = {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content: { type: string; text?: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

export function addUsage(total: Usage, msg: Pick<Msg, "model" | "usage">) {
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

/** Parse a response's text against `schema`, or explain why it can't be.
 *  `what` completes "Claude declined to …", e.g. "code this transcript". */
export function readStructured<T>(
  msg: Pick<Msg, "stop_reason" | "stop_details" | "content">,
  schema: z.ZodType<T>,
  what: string,
): T | string {
  if (msg.stop_reason === "refusal") {
    const why = msg.stop_details?.category ? ` (${msg.stop_details.category})` : "";
    return `Claude declined to ${what}${why}. Nothing was saved.`;
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
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : "Claude's answer wasn't the expected format. Nothing was saved.";
}

/** One streamed, structured request: Opus 5.5 at high effort, a cacheable
 *  system prompt, and the server-side fallback so a classifier false positive
 *  retries on the recommended model instead of failing. Adds to `usage`;
 *  throws ClaudeError (carrying usage) when there's no usable answer. */
export async function structuredCall<T>(
  client: Anthropic,
  args: { system: string; user: string; schema: z.ZodType<T>; what: string; usage: Usage },
): Promise<T> {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64_000,
    output_config: { effort: EFFORT, format: betaZodOutputFormat(args.schema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: args.user }],
  });
  const msg = (await stream.finalMessage()) as unknown as Msg;
  addUsage(args.usage, msg);
  const read = readStructured(msg, args.schema, args.what);
  if (typeof read === "string") throw new ClaudeError(read, args.usage);
  return read;
}
