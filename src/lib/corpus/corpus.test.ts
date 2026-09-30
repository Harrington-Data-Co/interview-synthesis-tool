import { describe, expect, it } from "vitest";
import { foldLines, reach } from "./chain";
import {
  bandCoverage,
  compareRefs,
  coverageNote,
  groupColumns,
  saturation,
  saturationNote,
  singleBand,
  themeRows,
  unthemed,
  UNLABELLED,
  type Facet,
  type MatrixCell,
} from "./derive";

const cells: MatrixCell[] = [
  { themeId: "A", transcriptId: "t1", codes: 2 },
  { themeId: "A", transcriptId: "t2", codes: 1 },
  { themeId: "A", transcriptId: "t3", codes: 3 },
  { themeId: "B", transcriptId: "t2", codes: 1 },
  { themeId: "C", transcriptId: "t4", codes: 2 },
  { themeId: null, transcriptId: "t1", codes: 4 },
  { themeId: null, transcriptId: "t4", codes: 1 },
];
const ids = ["t1", "t2", "t3", "t4"];

const dept: Facet = {
  id: "dept",
  name: "Department",
  values: ["Ops", "Finance", "IT"],
  valueOf: new Map([
    ["t1", "Finance"],
    ["t2", "Ops"],
    ["t3", "Ops"],
  ]),
};

describe("groupColumns", () => {
  it("orders bands by the facet's values, drops empty ones, and puts unlabelled last", () => {
    const bands = groupColumns(ids, dept);
    expect(bands.map((b) => [b.name, b.ids])).toEqual([
      ["Ops", ["t2", "t3"]],
      ["Finance", ["t1"]],
      [UNLABELLED, ["t4"]],
    ]);
    expect(bands.map((b) => b.labelled)).toEqual([true, true, false]);
  });

  it("puts everything in one band without a facet", () => {
    expect(groupColumns(ids, null)).toEqual([{ name: "All interviews", ids, labelled: false }]);
    expect(groupColumns([], null)).toEqual([]);
  });
});

describe("themeRows", () => {
  it("sums counts per theme, keeping the order it is given", () => {
    const rows = themeRows(["C", "B", "A", "D"], cells);
    expect(rows.map((r) => [r.themeId, r.ivs, r.codes])).toEqual([
      ["C", 1, 2],
      ["B", 1, 1],
      ["A", 3, 6],
      ["D", 0, 0],
    ]);
    expect(rows[2].counts.get("t3")).toBe(3);
  });

  it("ignores themes it wasn't asked for, and unthemed cells", () => {
    expect(themeRows(["B"], cells).map((r) => r.codes)).toEqual([1]);
  });
});

describe("compareRefs", () => {
  it("orders theme refs by number, not character by character", () => {
    expect(["TH-12", "TH-2", "TH-1", "TH-10", "TH-3"].sort(compareRefs)).toEqual(["TH-1", "TH-2", "TH-3", "TH-10", "TH-12"]);
  });
});

describe("unthemed", () => {
  it("counts only the null-theme cells", () => {
    expect([...unthemed(cells)]).toEqual([
      ["t1", 4],
      ["t4", 1],
    ]);
  });
});

describe("singleBand", () => {
  const bands = groupColumns(ids, dept);
  const rows = new Map(themeRows(["A", "B", "C"], cells).map((r) => [r.themeId, r]));

  it("names the band a row sits entirely inside", () => {
    expect(singleBand(rows.get("B")!, bands)).toBe("Ops");
  });
  it("is null when the row spans bands", () => {
    expect(singleBand(rows.get("A")!, bands)).toBeNull();
  });
  it("never calls Unlabelled a group", () => {
    expect(singleBand(rows.get("C")!, bands)).toBeNull();
  });
  it("is null with only one band to compare", () => {
    expect(singleBand(rows.get("B")!, groupColumns(ids, null))).toBeNull();
  });
});

describe("saturation", () => {
  const rows = themeRows(["A", "B", "C"], cells);

  it("counts a theme as new in the first interview that holds it", () => {
    expect(saturation(ids, rows)).toEqual([
      { id: "t1", fresh: 1, seen: 1 },
      { id: "t2", fresh: 1, seen: 2 },
      { id: "t3", fresh: 0, seen: 2 },
      { id: "t4", fresh: 1, seen: 3 },
    ]);
  });

  it("follows the order it is given", () => {
    expect(saturation(["t4", "t3", "t2", "t1"], rows).map((b) => b.fresh)).toEqual([1, 1, 1, 0]);
  });

  it("describes the tail", () => {
    const key = (id: string) => id.toUpperCase();
    expect(saturationNote([], key)).toMatch(/No themes/);
    expect(saturationNote(saturation(ids, rows), key)).toBe(
      "T4 still added 1 new theme. Saturation isn't reached; keep interviewing.",
    );
    expect(saturationNote(saturation(["t1", "t2", "t4", "t3"], rows), key)).toMatch(/^T3 added no new theme/);
    expect(saturationNote(saturation(["t3", "t4", "t2", "t1"], themeRows(["A", "C"], cells)), key)).toMatch(
      /^The last 2 interviews added no new theme/,
    );
  });
});

describe("bandCoverage", () => {
  it("counts interviews and codes per band and flags thin labelled bands", () => {
    const codes = new Map([
      ["t1", 6],
      ["t2", 2],
      ["t3", 3],
      ["t4", 3],
    ]);
    const cov = bandCoverage(groupColumns(ids, dept), (id) => codes.get(id) ?? 0);
    expect(cov).toEqual([
      { name: "Ops", ivs: 2, codes: 5, share: 0.5, thin: true },
      { name: "Finance", ivs: 1, codes: 6, share: 0.25, thin: true },
      { name: UNLABELLED, ivs: 1, codes: 3, share: 0.25, thin: false },
    ]);
    expect(coverageNote(cov, "Department")).toBe(
      "Ops and Finance carry two interviews or fewer. A theme resting mostly inside those groups is a lead, not a finding.",
    );
  });

  it("explains a missing facet or missing labels", () => {
    expect(coverageNote([], null)).toMatch(/Add a label axis/);
    expect(coverageNote([{ name: UNLABELLED, ivs: 4, codes: 9, share: 1, thin: false }], "Department")).toMatch(
      /No interview carries a department/,
    );
  });
});

describe("reach", () => {
  const edges = [
    { a: "ln-1", b: "cd-a" },
    { a: "ln-2", b: "cd-a" },
    { a: "ln-3", b: "cd-b" },
    { a: "cd-a", b: "it-1" },
    { a: "cd-a", b: "th-x" },
    { a: "cd-b", b: "th-x" },
    { a: "cd-b", b: "th-y" },
    { a: "th-x", b: "pa-1" },
    { a: "cd-b", b: "pa-2" },
  ];

  it("walks down from a line", () => {
    expect([...reach(edges, "ln-1")].sort()).toEqual(["cd-a", "it-1", "ln-1", "pa-1", "th-x"]);
  });

  it("walks up and down from a theme without crossing into siblings", () => {
    // cd-b is upstream of th-x; its other theme th-y and direct paragraph pa-2
    // are not part of th-x's chain.
    expect([...reach(edges, "th-x")].sort()).toEqual(["cd-a", "cd-b", "ln-1", "ln-2", "ln-3", "pa-1", "th-x"]);
  });

  it("walks up from a paragraph through themes and direct citations", () => {
    expect([...reach(edges, "pa-2")].sort()).toEqual(["cd-b", "ln-3", "pa-2"]);
  });

  it("handles an unknown node", () => {
    expect([...reach(edges, "nope")]).toEqual(["nope"]);
  });
});

describe("foldLines", () => {
  const lines = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("keeps coded lines and one line of lead-in, folding the rest", () => {
    expect(foldLines(lines, [{ start: 4, end: 5 }, { start: 9, end: 9 }])).toEqual([
      { kind: "gap", from: 1, to: 2 },
      { kind: "line", n: 3 },
      { kind: "line", n: 4 },
      { kind: "line", n: 5 },
      { kind: "gap", from: 6, to: 7 },
      { kind: "line", n: 8 },
      { kind: "line", n: 9 },
      { kind: "gap", from: 10, to: 10 },
    ]);
  });

  it("folds everything when nothing is coded, and nothing when all is", () => {
    expect(foldLines(lines, [])).toEqual([{ kind: "gap", from: 1, to: 10 }]);
    expect(foldLines([1, 2], [{ start: 1, end: 2 }]).every((r) => r.kind === "line")).toBe(true);
  });
});
