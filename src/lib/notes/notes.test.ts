import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeError } from "@/lib/claude/call";
import { gateItems } from "./gate";
import { noteMessage, type NoteCode, type NoteSection } from "./prompt";
import { noteResponseSchema, writeNote } from "./run";

const sections: NoteSection[] = [
  { id: "s-pain", name: "Pain points", requires: ["Pain"], note: "What goes wrong." },
  { id: "s-any", name: "Role & context", requires: [], note: null },
];
const code = (ref: string, type: string, id = ref.toLowerCase()): NoteCode => ({
  id,
  ref,
  type,
  label: `${ref} label`,
  verbatim: `${ref} quote`,
  note: null,
  line_start: 3,
  line_end: 4,
});
const codes = [code("PAIN-01", "Pain"), code("PAIN-02", "Pain"), code("STEP-01", "Step")];

describe("gateItems", () => {
  it("resolves sections and refs to ids, deduplicating citations", () => {
    const { accepted, rejected } = gateItems(
      [
        { section: "S1", text: "  They rebuild\nit by hand. ", refs: ["PAIN-01", "pain-02", "PAIN-01"] },
        { section: "s2", text: "They run the monthly rebuild.", refs: ["STEP-01"] },
      ],
      sections,
      codes,
    );
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([
      { section_id: "s-pain", text: "They rebuild it by hand.", code_ids: ["pain-01", "pain-02"] },
      { section_id: "s-any", text: "They run the monthly rebuild.", code_ids: ["step-01"] },
    ]);
  });

  it("places items whose section is labelled with its name too, as Claude sometimes writes it", () => {
    // From a real run: every item came back as "S2. How the work happens today"
    // and the like, and a strict key match rejected all of them.
    const { accepted, rejected } = gateItems(
      [
        { section: "S1. Pain points", text: "a", refs: ["PAIN-01"] },
        { section: "s2 — Role & context", text: "b", refs: ["STEP-01"] },
        { section: "Pain points", text: "c", refs: ["PAIN-02"] },
        { section: "S01", text: "d", refs: ["PAIN-02"] },
      ],
      sections,
      codes,
    );
    expect(rejected).toEqual([]);
    expect(accepted.map((a) => a.section_id)).toEqual(["s-pain", "s-any", "s-pain", "s-pain"]);
  });

  it("rejects unknown sections, empty items, made-up refs and off-type citations, saying why", () => {
    const { accepted, rejected } = gateItems(
      [
        { section: "S9", text: "x", refs: ["PAIN-01"] },
        { section: "S1", text: " ", refs: ["PAIN-01"] },
        { section: "S1", text: "x", refs: [] },
        { section: "S1", text: "x", refs: ["PAIN-01", "GOAL-07", "TOOL-02"] },
        { section: "S1", text: "x", refs: ["STEP-01"] },
      ],
      sections,
      codes,
    );
    expect(accepted).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      '"S9" isn\'t one of the template\'s sections.',
      "The item has no text.",
      "The item cites no codes.",
      "GOAL-07, TOOL-02 aren't codes in this interview.",
      "Pain points takes Pain codes; STEP-01 is a Step.",
    ]);
  });
});

describe("noteMessage", () => {
  it("keys sections S1… with their types and guidance, and lists codes with evidence", () => {
    const msg = noteMessage({ title: "Roster", participant: "Cy Park", templateName: "Discovery", templateScope: null }, sections, codes);
    expect(msg).toContain("S1. Pain points — takes Pain codes\n    What goes wrong.");
    expect(msg).toContain("S2. Role & context — takes any codes");
    expect(msg).toContain("PAIN-01 [Pain] PAIN-01 label — “PAIN-01 quote” (L3–4)");
  });
});

describe("noteResponseSchema", () => {
  it("only accepts the template's own section keys", () => {
    const schema = noteResponseSchema(2);
    expect(schema.safeParse({ items: [{ section: "S2", text: "x", refs: [] }] }).success).toBe(true);
    expect(schema.safeParse({ items: [{ section: "S2. Role & context", text: "x", refs: [] }] }).success).toBe(false);
    expect(schema.safeParse({ items: [{ section: "S3", text: "x", refs: [] }] }).success).toBe(false);
  });
});

describe("writeNote", () => {
  const client = (reply: object) =>
    ({ beta: { messages: { stream: () => ({ finalMessage: async () => reply }) } } }) as unknown as Anthropic;
  const usage = { input_tokens: 4000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const ctx = { title: "T", participant: null, templateName: "D", templateScope: null };

  it("returns Claude's items and the cost", async () => {
    const items = [{ section: "S1", text: "x", refs: ["PAIN-01"] }];
    const r = await writeNote(ctx, sections, codes, client({ model: "claude-opus-5-5", stop_reason: "end_turn", usage, content: [{ type: "text", text: JSON.stringify({ items }) }] }));
    expect(r.proposals).toEqual(items);
    expect(r.usage.cost_usd).toBeCloseTo(0.036);
  });

  it("explains a refusal in the note's own terms", async () => {
    const err = await writeNote(ctx, sections, codes, client({ model: "claude-opus-5-5", stop_reason: "refusal", usage, content: [] })).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect(err.message).toBe("Claude declined to write this note. Nothing was saved.");
  });
});
