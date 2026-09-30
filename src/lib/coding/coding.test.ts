import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { chunkLines } from "./chunks";
import { gate, quoteFits, type Proposal } from "./gate";
import { transcriptMessage, type CodingLine } from "./prompt";
import { codeTranscript, CodingError, readResponse } from "./run";

const L = (n: number, text: string, role: CodingLine["role"] = "participant", speaker = "Cy"): CodingLine => ({
  n,
  speaker,
  text,
  role,
  displayName: null,
});
const lines = [
  L(1, "How do you build the roster?", "interviewer", "Ryan"),
  L(2, "We rebuild the roster by hand every month."),
  L(3, "It takes two days. Nobody trusts the numbers."),
  L(4, "Why?", "interviewer", "Ryan"),
  L(5, "The export breaks."),
];
const P = (p: Partial<Proposal>): Proposal => ({
  line_start: 2,
  line_end: 2,
  type: "Pain",
  label: "Roster rebuilt by hand",
  verbatim: "rebuild the roster by hand",
  note: "",
  ...p,
});

describe("quoteFits (mirrors the database's check)", () => {
  const byN = new Map(lines.map((l) => [l.n, l]));
  it("accepts exact quotes within one line or across lines", () => {
    expect(quoteFits(byN, 2, 2, "rebuild the roster by hand")).toBe(true);
    expect(quoteFits(byN, 2, 3, "by hand every month. It takes two days")).toBe(true);
  });
  it("rejects paraphrase and ranges wider than the quote", () => {
    expect(quoteFits(byN, 3, 3, "It takes 2 days")).toBe(false);
    expect(quoteFits(byN, 2, 3, "Nobody trusts")).toBe(false);
    expect(quoteFits(byN, 2, 3, "We rebuild")).toBe(false);
  });
  it("finds a later occurrence when the first doesn't span the range", () => {
    const m = new Map([
      [1, L(1, "yes and yes")],
      [2, L(2, "yes indeed")],
    ]);
    expect(quoteFits(m, 1, 2, "yes yes")).toBe(true); // "…and yes" + " " + "yes indeed"
  });
});

describe("gate", () => {
  it("keeps good codes, explains rejections, and drops duplicates", () => {
    const { accepted, rejected } = gate(
      [
        P({}),
        P({}), // duplicate
        P({ verbatim: "  rebuild   the roster\nby hand " }), // whitespace-normalised duplicate
        P({ line_start: 3, line_end: 3, verbatim: "It takes 2 days" }),
        P({ line_start: 3, line_end: 5, verbatim: "Nobody trusts the numbers. Why? The export" }),
        P({ line_start: 9, line_end: 9 }),
        P({ line_start: 3, line_end: 2 }),
        P({ type: "Quote" as Proposal["type"] }),
        P({ label: " " }),
      ],
      lines,
    );
    expect(accepted).toHaveLength(1);
    expect(rejected.map((r) => r.reason)).toEqual([
      "The quote isn't word for word in lines 3–3, or the range is wider than the quote.",
      "Claude's codes may only quote participants; lines 3–5 include an interviewer.",
      "Line L9 doesn't exist.",
      "Invalid line range L3–L2.",
      '"Quote" isn\'t a code type Claude may use.',
      "Missing its quote or label.",
    ]);
  });
});

describe("chunkLines", () => {
  const many = Array.from({ length: 50 }, (_, i) => L(i + 1, "x".repeat(84))); // 100 chars each with overhead
  it("leaves a normal interview whole", () => {
    expect(chunkLines(lines)).toEqual([{ lines, codeFrom: 1 }]);
  });
  it("splits a long one with overlapping context and no gaps", () => {
    const chunks = chunkLines(many, 2_000, 3);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].codeFrom).toBe(1);
    for (let i = 1; i < chunks.length; i++) {
      const prevLast = chunks[i - 1].lines.at(-1)!.n;
      expect(chunks[i].codeFrom).toBe(prevLast + 1); // every line coded exactly once
      expect(chunks[i].lines[0].n).toBe(chunks[i].codeFrom - 3); // with 3 lines of context
    }
    expect(chunks.at(-1)!.lines.at(-1)!.n).toBe(50);
  });
});

describe("transcriptMessage", () => {
  it("lists the people, numbers lines, tags roles, and prefers display names", () => {
    const msg = transcriptMessage(
      {
        title: "Roster",
        people: [
          { name: "Jen Koester", role: "interviewer", title: null, organization: "Harrington Data" },
          { name: "Cyrus Park", role: "participant", title: "Director", organization: "DOE › OEL" },
        ],
      },
      [L(1, "Hi?", "interviewer", "Jen :)"), { ...L(2, "Hello."), displayName: "Cyrus Park" }],
    );
    expect(msg).toContain("People:\n- Jen Koester (interviewer), Harrington Data\n- Cyrus Park (participant), Director, DOE › OEL");
    expect(msg).toContain("L1 [I] Jen :): Hi?\nL2 [P] Cyrus Park: Hello.");
  });
});

describe("readResponse", () => {
  const ok = { stop_reason: "end_turn", content: [{ type: "thinking" }, { type: "text", text: JSON.stringify({ codes: [P({})] }) }] };
  it("reads codes from the text block, ignoring thinking blocks", () => {
    expect(readResponse(ok)).toEqual([P({})]);
  });
  it("explains refusals, truncation, and malformed answers", () => {
    expect(readResponse({ stop_reason: "refusal", stop_details: { category: "bio" }, content: [] })).toMatch(/declined.*\(bio\)/);
    expect(readResponse({ stop_reason: "max_tokens", content: [] })).toMatch(/length limit/);
    expect(readResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "{nope" }] })).toMatch(/format/);
    expect(readResponse({ stop_reason: "end_turn", content: [{ type: "text", text: '{"codes":[{"type":"Pain"}]}' }] })).toMatch(/format/);
  });
});

describe("codeTranscript", () => {
  const fakeClient = (replies: object[]) => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          stream: (params: Record<string, unknown>) => {
            calls.push(params);
            return { finalMessage: async () => replies.shift() };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  };
  const reply = (codes: Proposal[], extra: object = {}) => ({
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content: [{ type: "text", text: JSON.stringify({ codes }) }],
    ...extra,
  });
  const ctx = { title: "T", people: [] };

  it("sends Opus 5.5 at high effort with fallbacks and structured output, and prices the run", async () => {
    const { client, calls } = fakeClient([reply([P({})])]);
    const { proposals, usage } = await codeTranscript(ctx, lines, client);
    expect(proposals).toEqual([P({})]);
    expect(calls[0]).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
      output_config: { effort: "high" },
    });
    expect(calls[0]).not.toHaveProperty("thinking"); // always on for Opus 5.5
    expect(usage).toEqual({ served_by: "claude-opus-5-5", input_tokens: 10_000, output_tokens: 2_000, cost_usd: 0.08 });
  });

  it("throws a CodingError carrying usage when Claude declines", async () => {
    const { client } = fakeClient([reply([], { stop_reason: "refusal", stop_details: { category: "cyber" } })]);
    const err = await codeTranscript(ctx, lines, client).catch((e) => e);
    expect(err).toBeInstanceOf(CodingError);
    expect(err.usage.input_tokens).toBe(10_000);
  });

  it("leaves cost unknown when a fallback model with no known price answers", async () => {
    const { client } = fakeClient([reply([P({})], { model: "claude-somewhere-else" })]);
    expect((await codeTranscript(ctx, lines, client)).usage.cost_usd).toBeNull();
  });
});
