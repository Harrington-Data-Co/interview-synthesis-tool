import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { gateParagraphs } from "./gate";
import { memoMarkdown } from "./markdown";
import { memoMessage, type MemoCode, type MemoSection, type MemoTheme } from "./prompt";
import { memoResponseSchema, writeMemo } from "./run";

const sections: MemoSection[] = [
  { id: "s-find", name: "Findings", requires: ["themes"], note: "Most-supported first." },
  { id: "s-q", name: "Open questions", requires: ["Question"], note: null },
  { id: "s-any", name: "Notes", requires: [], note: null },
];
const code = (key: string, type: string): MemoCode => ({ id: key.toLowerCase(), key, type, label: `${key} label`, verbatim: `${key} quote` });
const codes = [code("I1:PAIN-01", "Pain"), code("I2:STEP-01", "Step"), code("I1:QUES-01", "Question")];
const themes: MemoTheme[] = [
  { id: "th1", ref: "TH-1", title: "Rosters are rebuilt by hand", description: "Both.", codeIds: ["i1:pain-01", "i2:step-01"], interviews: 2 },
];

describe("gateParagraphs", () => {
  it("resolves sections, themes and codes; codes within a cited theme are allowed", () => {
    const { accepted, rejected } = gateParagraphs(
      [
        { section: "S1", text: "Rosters are rebuilt by hand.", themes: ["th-1"], codes: ["I1:PAIN-01"] },
        { section: "S2. Open questions", text: "Who owns it?", themes: [], codes: ["I1:QUES-01"] },
        { section: "Notes", text: "Anything goes.", themes: [], codes: ["I2:STEP-01"] },
      ],
      sections,
      themes,
      codes,
    );
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([
      { section_id: "s-find", text: "Rosters are rebuilt by hand.", theme_ids: ["th1"], code_ids: ["i1:pain-01"] },
      { section_id: "s-q", text: "Who owns it?", theme_ids: [], code_ids: ["i1:ques-01"] },
      { section_id: "s-any", text: "Anything goes.", theme_ids: [], code_ids: ["i2:step-01"] },
    ]);
  });

  it("rejects whole paragraphs that cite nothing, cite unknowns, or cite outside the section", () => {
    const { accepted, rejected } = gateParagraphs(
      [
        { section: "S1", text: "Nothing.", themes: [], codes: [] },
        { section: "S1", text: "Made up.", themes: ["TH-9"], codes: ["I1:PAIN-01"] },
        { section: "S2", text: "Theme here.", themes: ["TH-1"], codes: [] },
        { section: "S1", text: "Stray.", themes: [], codes: ["I1:QUES-01"] },
      ],
      sections,
      themes,
      codes,
    );
    expect(accepted).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "The paragraph cites nothing.",
      "TH-9 isn't a confirmed theme or code in this project.",
      "Open questions doesn't fill from themes.",
      "Findings fills from themes; I1:QUES-01 is a Question outside the themes cited.",
    ]);
  });
});

describe("memoMessage", () => {
  it("lists sections, confirmed themes with their evidence, and the other codes", () => {
    const msg = memoMessage({ project: "PDG", client: "DE DOE", interviews: 2, templateName: "Findings memo" }, sections, themes, codes);
    expect(msg).toContain("S1. Findings — fills from themes\n    Most-supported first.");
    expect(msg).toContain("TH-1. Rosters are rebuilt by hand (2 codes, 2 of the interviews)");
    expect(msg).toContain("    I1:PAIN-01 [Pain] I1:PAIN-01 label — “I1:PAIN-01 quote”");
    expect(msg).toContain("<other_codes>\nI1:QUES-01 [Question]");
  });
});

describe("memoResponseSchema", () => {
  it("constrains sections to the template's keys", () => {
    const s = memoResponseSchema(3);
    expect(s.safeParse({ title: "T", paragraphs: [{ section: "S3", text: "x", themes: [], codes: [] }] }).success).toBe(true);
    expect(s.safeParse({ title: "T", paragraphs: [{ section: "S4", text: "x", themes: [], codes: [] }] }).success).toBe(false);
  });
});

describe("writeMemo", () => {
  it("returns the headline and paragraphs", async () => {
    const paragraphs = [{ section: "S1", text: "x", themes: ["TH-1"], codes: [] }];
    const client = {
      beta: {
        messages: {
          stream: () => ({
            finalMessage: async () => ({
              model: "claude-opus-5-5",
              stop_reason: "end_turn",
              usage: { input_tokens: 20000, output_tokens: 3000 },
              content: [{ type: "text", text: JSON.stringify({ title: " Headline ", paragraphs }) }],
            }),
          }),
        },
      },
    } as unknown as Anthropic;
    const r = await writeMemo({ project: "P", client: null, interviews: 2, templateName: "M" }, sections, themes, codes, client);
    expect(r.title).toBe("Headline");
    expect(r.proposals).toEqual(paragraphs);
  });
});

describe("memoMarkdown", () => {
  it("renders sections and turns citations into shared, numbered footnotes", () => {
    const md = memoMarkdown({
      title: "Rosters are rebuilt by hand",
      project: "PDG",
      client: "DE DOE",
      sections: [
        { name: "Findings", paragraphs: [{ text: "They rebuild it.", themes: ["th1"], codes: ["c1"] }, { text: "Again.", themes: ["th1"], codes: [] }] },
        { name: "Empty", paragraphs: [] },
      ],
      themes: new Map([["th1", { ref: "TH-1", title: "Rosters are rebuilt by hand" }]]),
      codes: new Map([["c1", { key: "I1:PAIN-01", participant: "Liz Harris", verbatim: "by hand" }]]),
    });
    expect(md).toBe(
      [
        "# Rosters are rebuilt by hand",
        "",
        "*PDG · DE DOE*",
        "",
        "## Findings",
        "",
        "They rebuild it.[^1][^2]",
        "",
        "Again.[^1]",
        "",
        "---",
        "",
        "[^1]: TH-1 — Rosters are rebuilt by hand",
        "[^2]: I1:PAIN-01, Liz Harris: “by hand”",
        "",
      ].join("\n"),
    );
  });
});
