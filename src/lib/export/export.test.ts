import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { blocksDocx, blocksMarkdown } from "./blocks";
import { codingSheets, type ExportCode } from "./coding";
import { codesSheets } from "./codes";
import { safeName } from "./file";
import { noteBlocks, projectNotesBlocks } from "./notes";
import { workbook } from "./sheet";
import { themeBlocks, themeSheets, type ThemeExport } from "./themes";

const code = (id: string, ref: string, a: number, b: number, extra: Partial<ExportCode> = {}): ExportCode => ({
  id, ref, type: "Pain", label: `${ref} label`, verbatim: `${ref} words`, note: null, line_start: a, line_end: b, origin: "claude", merged_into_id: null, ...extra,
});

describe("codingSheets", () => {
  const lines = [1, 2, 3, 4].map((n) => ({ n, at: null, speaker: "Ann", role: "participant", text: `line ${n}` }));
  const sheets = codingSheets(
    [code("a", "PAIN-01", 2, 3), code("b", "PAIN-02", 3, 3, { merged_into_id: "a" })],
    lines,
  );

  it("puts the codes that cover a line beside it", () => {
    const rows = sheets[0].rows;
    expect(rows.map((r) => r.codes)).toEqual(["", "PAIN-01 · Pain: PAIN-01 label", "PAIN-01 · Pain: PAIN-01 label", ""]);
  });

  it("lists merged codes on the codes sheet, naming what they became", () => {
    expect(sheets[1].rows.map((r) => [r.ref, r.lines, r.merged])).toEqual([
      ["PAIN-01", "L2–3", null],
      ["PAIN-02", "L3", "PAIN-01"],
    ]);
  });
});

describe("noteBlocks and Markdown", () => {
  const md = blocksMarkdown(
    noteBlocks({
      transcript: "Call with Ann",
      project: "Intake",
      client: "Acme",
      template: "Interview notes",
      sections: [
        { name: "Pains", items: [{ text: "Rosters are rebuilt by hand.", codeIds: ["a", "gone"] }, { text: "Second.", codeIds: ["a"] }] },
        { name: "Empty", items: [] },
      ],
      codes: new Map([["a", { ref: "PAIN-01", label: "x", verbatim: "I rebuild it", line_start: 4, line_end: 5 }]]),
    }),
  );

  it("renders sections with items, skipping empty sections and unknown citations", () => {
    expect(md).toContain("# Call with Ann");
    expect(md).toContain("## Pains");
    expect(md).not.toContain("Empty");
    expect(md).toContain("- Rosters are rebuilt by hand.[^1]");
    expect(md).toContain("- Second.[^1]"); // the same evidence is one footnote
    expect(md).toContain("[^1]: PAIN-01 (L4–5): “I rebuild it”");
    expect(md).not.toContain("[^2]");
  });
});

describe("projectNotesBlocks", () => {
  const codes = new Map([["a", { ref: "PAIN-01", label: "x", verbatim: "words", line_start: 1, line_end: 1 }]]);
  const sections = [{ name: "Pains", items: [{ text: "Item.", codeIds: ["a"] }] }];
  const md = blocksMarkdown(
    projectNotesBlocks({
      project: "Intake",
      client: "Acme",
      interviews: [
        { title: "Ann call", meta: "Ann · Acme", notes: [{ template: "Notes", sections }], codes },
        { title: "Bo call", meta: "", notes: [{ template: "Notes", sections }, { template: "Follow-up", sections }], codes },
      ],
    }),
  );

  it("gives each interview a heading and names templates only when there are several", () => {
    expect(md).toContain("# Intake — Interview notes");
    expect(md).toContain("## Ann call\n\n*Ann · Acme*\n\n### Pains");
    expect(md).toContain("## Bo call\n\n### Notes\n\n#### Pains");
    expect(md.match(/^### Follow-up$/m)).not.toBeNull();
  });

  it("keeps citations from different interviews apart", () => {
    expect(md).toContain("[^1]: Ann call · PAIN-01 (L1): “words”");
    expect(md).toContain("[^2]: Bo call · PAIN-01 (L1): “words”");
  });
});

describe("themes", () => {
  const t: ThemeExport = {
    project: "Intake",
    client: null,
    themes: [
      { id: "t1", ref: "TH-1", title: "Hand-built rosters", description: "Both do it.", status: "confirmed", origin: "claude", codeIds: ["a", "b", "stale"] },
      { id: "t2", ref: "TH-2", title: "Maybe", description: null, status: "proposed", origin: "human", codeIds: [] },
    ],
    codes: new Map([
      ["a", { key: "I1:PAIN-01", transcriptId: "x", type: "Pain", label: "l", verbatim: "one", line_start: 1, line_end: 1 }],
      ["b", { key: "I2:PAIN-01", transcriptId: "y", type: "Pain", label: "l", verbatim: "two", line_start: 2, line_end: 4 }],
    ]),
    interviews: new Map([
      ["x", { key: "I1", title: "Ann call", participant: "Ann", organization: "Acme", role: "Controller" }],
      ["y", { key: "I2", title: "Bo call", participant: "Bo", organization: null, role: null }],
    ]),
  };

  it("counts only the evidence that still exists", () => {
    const md = blocksMarkdown(themeBlocks(t));
    expect(md).toContain("## TH-1 — Hand-built rosters");
    expect(md).toContain("*Confirmed · 2 codes across 2 interviews*");
    expect(md).toContain("> “two” — I2 · Bo (PAIN-01, L2–4)");
    expect(md).toContain("*Proposed · 0 codes across 0 interviews*");
  });

  it("gives Excel a row per theme and a row per theme-and-code", () => {
    const [themes, evidence] = themeSheets(t);
    expect(themes.rows.map((r) => [r.ref, r.codes, r.interviews])).toEqual([["TH-1", 2, 2], ["TH-2", 0, 0]]);
    expect(evidence.rows.map((r) => [r.theme, r.code, r.participant])).toEqual([["TH-1", "I1:PAIN-01", "Ann"], ["TH-1", "I2:PAIN-01", "Bo"]]);
  });
});

describe("codesSheets", () => {
  it("keys codes by interview, shows themes and merges, counts only active codes", () => {
    const [codes, interviews, themes] = codesSheets({
      interviews: [{ id: "x", key: "I1", title: "Ann call", participant: "Ann", organization: null, role: null, recordedOn: "2026-09-01", source: "Upload", status: "coded" }],
      codes: [
        { id: "a", transcriptId: "x", ref: "PAIN-01", type: "Pain", label: "l", verbatim: "v", note: "n", line_start: 1, line_end: 1, origin: "human", merged_into_id: null },
        { id: "b", transcriptId: "x", ref: "PAIN-02", type: "Pain", label: "l", verbatim: "v", note: null, line_start: 2, line_end: 2, origin: "claude", merged_into_id: "a" },
      ],
      themesOf: new Map([["a", ["TH-1", "TH-2"]]]),
      themes: [{ ref: "TH-1", title: "T", status: "confirmed" }],
    });
    expect(codes.rows.map((r) => [r.code, r.themes, r.merged, r.origin])).toEqual([
      ["I1:PAIN-01", "TH-1, TH-2", null, "Person"],
      ["I1:PAIN-02", "", "PAIN-01", "Claude"],
    ]);
    expect(interviews.rows[0].codes).toBe(1);
    expect(themes.rows[0].status).toBe("Confirmed");
  });
});

describe("files", () => {
  it("writes an xlsx that reads back, keeping a leading = as text", async () => {
    const buf = await workbook([{ name: "A/B: sheet", columns: [{ header: "Quote", key: "q" }], rows: [{ q: "=SUM(1,2)" }] }], "test");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("A B  sheet");
    expect(ws.getCell("A1").value).toBe("Quote");
    expect(ws.getCell("A2").value).toBe("=SUM(1,2)");
  });

  it("writes a docx whose body carries the text and citations", async () => {
    const buf = await blocksDocx(
      [{ kind: "title", text: "Title" }, { kind: "heading", text: "Section" }, { kind: "bullet", text: "Item", cites: ["PAIN-01 (L1): “words”"] }, { kind: "quote", text: "q", by: "Ann" }],
      "Title",
      "test",
    );
    const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    for (const s of ["Title", "Section", "Item", "PAIN-01 (L1)", "Ann"]) expect(xml).toContain(s);
  });

  it("makes file names safe", () => {
    expect(safeName('a/b:"c"\n d', "x")).toBe("abc d");
    expect(safeName("???", "fallback")).toBe("fallback");
  });
});
