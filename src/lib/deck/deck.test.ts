import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { MemoCode, MemoSection, MemoTheme } from "@/lib/memo/prompt";
import { gateSlides, type SlideProposal } from "./gate";
import type { LoadedDeck } from "./load";
import { attribution, evidenceLine } from "./evidence";
import { deckPptx } from "./pptx";
import { deckResponseSchema } from "./run";

const sections: MemoSection[] = [
  { id: "s1", name: "Findings", requires: ["themes"], note: null },
  { id: "s2", name: "Open questions", requires: ["Question"], note: null },
];
const themes: MemoTheme[] = [{ id: "th1", ref: "TH-1", title: "Reporting is rebuilt by hand", description: null, codeIds: ["c1", "c2"], interviews: 2 }];
const codes: MemoCode[] = [
  { id: "c1", key: "I1:PAIN-01", type: "Pain", label: "Re-keying", verbatim: "I key every number in twice" },
  { id: "c2", key: "I2:STEP-01", type: "Step", label: "Export", verbatim: "I pull the export" },
  { id: "c3", key: "I2:QUES-01", type: "Question", label: "Who owns it?", verbatim: "Nobody knows who owns the data" },
];
const slide = (over: Partial<SlideProposal>): SlideProposal => ({ section: "S1", layout: "finding", title: "Reporting is rebuilt by hand", bullets: [], quote: "", notes: "", themes: ["TH-1"], codes: [], ...over });

describe("gateSlides", () => {
  it("keeps a good slide, trims bullets and resolves the quote", () => {
    const { accepted, rejected } = gateSlides([slide({ bullets: [" Two days ", "", "a", "b", "c", "d", "e", "f"], quote: "I1:PAIN-01", codes: ["I1:PAIN-01"], notes: "  In both  interviews. " })], sections, themes, codes);
    expect(rejected).toEqual([]);
    expect(accepted[0]).toMatchObject({ section_id: "s1", bullets: ["Two days", "a", "b", "c", "d", "e"], quote_code_id: "c1", notes: "In both interviews.", theme_ids: ["th1"], code_ids: ["c1"] });
  });

  it("counts a quote as cited, and holds it to the section's rules", () => {
    const within = gateSlides([slide({ quote: "I2:STEP-01" })], sections, themes, codes);
    expect(within.accepted[0].code_ids).toEqual(["c2"]); // in a cited theme, so allowed
    const outside = gateSlides([slide({ section: "S2", themes: [], quote: "I1:PAIN-01", codes: ["I2:QUES-01"] })], sections, themes, codes);
    expect(outside.rejected[0].reason).toMatch(/fills from Question/);
  });

  it("rejects, with a reason, what the database would refuse", () => {
    const { rejected } = gateSlides(
      [slide({ quote: "I9:PAIN-09" }), slide({ title: " " }), slide({ themes: [] }), slide({ section: "S7" }), slide({ section: "S2" })],
      sections,
      themes,
      codes,
    );
    expect(rejected.map((r) => r.reason)).toEqual([
      "The quote I9:PAIN-09 isn't a code in this project.",
      "The slide has no title.",
      "The slide cites nothing.",
      `"S7" isn't one of the template's sections.`,
      "Open questions doesn't fill from themes.",
    ]);
  });

  it("the response schema takes the three layouts only", () => {
    const one = { section: "S1", layout: "finding", title: "t", bullets: [], quote: "", notes: "", themes: [], codes: [] };
    expect(deckResponseSchema(2).safeParse({ title: "x", slides: [one] }).success).toBe(true);
    expect(deckResponseSchema(2).safeParse({ title: "x", slides: [{ ...one, layout: "chart" }] }).success).toBe(false);
  });
});

describe("the .pptx", () => {
  const deck = {
    project: { id: "p", name: "PDG", client: "DOE" },
    template: { id: "t", name: "Findings readout", scope: null, sections },
    product: { id: "d", title: "Reporting is rebuilt by hand, every quarter", rendered_at: "" },
    interviews: [{ id: "t1" }, { id: "t2" }],
    themes: [{ id: "th1", ref: "TH-1", title: "x", status: "confirmed", codeIds: ["c1", "c2"] }],
    codes: [
      { id: "c1", transcriptId: "t1", verbatim: "I key every number in twice" },
      { id: "c2", transcriptId: "t2", verbatim: "I pull the export" },
    ],
    slides: [
      { id: "1", sectionId: "s1", ordinal: 1, layout: "statement", title: "Reporting is rebuilt by hand", bullets: [], quoteCodeId: null, notes: null, origin: "claude", themeIds: ["th1"], codeIds: [], lastEdit: null },
      { id: "2", sectionId: "s1", ordinal: 2, layout: "finding", title: "Numbers are keyed in twice", bullets: ["Two days a quarter"], quoteCodeId: "c1", notes: "Both interviews.", origin: "claude", themeIds: ["th1"], codeIds: ["c1"], lastEdit: null },
      { id: "3", sectionId: "s1", ordinal: 3, layout: "quote", title: "In their words", bullets: [], quoteCodeId: "c2", notes: null, origin: "human", themeIds: [], codeIds: ["c2"], lastEdit: null },
    ],
  } as unknown as LoadedDeck;

  it("says what a slide rests on", () => {
    expect(evidenceLine(deck.slides[1], deck)).toBe("TH-1 · 2 interviews");
    expect(evidenceLine(deck.slides[2], deck)).toBe("1 interview");
    expect(attribution("Program officer")).toBe("— Program officer");
    expect(attribution(null)).toBe("— Participant");
  });

  it("has a title slide and one slide each, quotes verbatim, never a name", async () => {
    const buf = await deckPptx(deck, new Map([["c1", "Program officer"], ["c2", null]]));
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slideFiles).toHaveLength(4);
    const xml = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(xml).toContain("I key every number in twice");
    expect(xml).toContain("— Program officer");
    expect(xml).toContain("Evidence: TH-1 · 2 interviews");
    const notes = Object.keys(zip.files).filter((f) => /notesSlide\d+\.xml$/.test(f));
    const allNotes = (await Promise.all(notes.map((f) => zip.file(f)!.async("string")))).join("");
    expect(allNotes).toContain("Both interviews.");
  });
});
