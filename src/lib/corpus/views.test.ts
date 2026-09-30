import { describe, expect, it } from "vitest";
import { groupColumns, themeRows, type Facet, type MatrixCell } from "./derive";
import { chordLayout, chordMatrix, evidenceMix, groupShares, isStrong, leaning, memoFlag } from "./views";

const ids = ["t1", "t2", "t3", "t4", "t5", "t6"];
const dept: Facet = {
  id: "dept",
  name: "Department",
  values: ["Grants", "Admin"],
  valueOf: new Map([
    ["t1", "Grants"],
    ["t2", "Grants"],
    ["t3", "Grants"],
    ["t4", "Grants"],
    ["t5", "Admin"],
  ]),
};
const cells: MatrixCell[] = [
  // A: 3 of 4 grants interviews and the one admin interview
  ...["t1", "t2", "t3", "t5"].map((t) => ({ themeId: "A", transcriptId: t, codes: 1 })),
  // B: grants only
  ...["t1", "t2", "t3"].map((t) => ({ themeId: "B", transcriptId: t, codes: 2 })),
  // C: one interview
  { themeId: "C", transcriptId: "t6", codes: 1 },
];
const rows = new Map(themeRows(["A", "B", "C"], cells).map((r) => [r.themeId, r]));
const bands = groupColumns(ids, dept);

describe("groupShares", () => {
  it("divides by the group's size, not the corpus", () => {
    expect(groupShares(rows.get("A")!, bands)).toEqual([
      { band: "Grants", labelled: true, hit: 3, size: 4, share: 0.75 },
      { band: "Admin", labelled: true, hit: 1, size: 1, share: 1 },
      { band: "Unlabelled", labelled: false, hit: 0, size: 1, share: 0 },
    ]);
  });
});

describe("memo check", () => {
  it("calls a theme strong when it is broad and crosses groups", () => {
    expect(isStrong(rows.get("A")!, bands, 6)).toBe(true);
    // Broad enough, but inside one group.
    expect(isStrong(rows.get("B")!, bands, 6)).toBe(false);
    // Without groups, breadth alone decides.
    expect(isStrong(rows.get("B")!, groupColumns(ids, null), 6)).toBe(true);
    expect(isStrong(rows.get("C")!, bands, 6)).toBe(false);
  });

  it("flags a strong theme the memo leaves out", () => {
    expect(memoFlag(rows.get("A")!, bands, 6, false)).toEqual({
      kind: "strong-uncited",
      reason: "Rests on 4 of 6 interviews, but the memo doesn't cite it.",
    });
    expect(memoFlag(rows.get("C")!, bands, 6, false)).toBeNull();
  });

  it("flags a cited theme that rests on little or on one group", () => {
    expect(memoFlag(rows.get("C")!, bands, 6, true)?.reason).toBe("Cited, but rests on one interview.");
    expect(memoFlag(rows.get("B")!, bands, 6, true)?.reason).toBe("Cited, but every interview behind it is in Grants.");
    expect(memoFlag(rows.get("A")!, bands, 6, true)).toBeNull();
  });
});

describe("evidenceMix", () => {
  it("folds types into kinds and keeps the per-type counts", () => {
    const mix = evidenceMix(["Pain", "Pain", "Constraint", "Goal", "Tool", "Quote", "Mystery"]);
    expect(mix.total).toBe(7);
    expect(mix.kinds).toEqual({ problems: 3, goals: 1, today: 1, other: 2 });
    expect(mix.types).toEqual({ Pain: 2, Constraint: 1, Goal: 1, Tool: 1, Quote: 1, Mystery: 1 });
  });

  it("names the kind that holds a majority, if any", () => {
    expect(leaning(evidenceMix(["Pain", "Pain", "Goal"]))).toBe("problems");
    expect(leaning(evidenceMix(["Pain", "Goal"]))).toBeNull();
    expect(leaning(evidenceMix([]))).toBeNull();
  });
});

describe("chord diagram", () => {
  const all = [...rows.values()]; // A, B, C
  it("sizes each end by its own theme's codes in shared interviews", () => {
    // A and B share t1–t3: A has 1 code in each, B 2.
    expect(chordMatrix(all)).toEqual([
      [0, 3, 0],
      [6, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("lays every theme on the circle, isolated ones included, with padded arcs", () => {
    const { arcs, ribbons } = chordLayout(chordMatrix(all), 0.1, 0.05);
    expect(arcs.map((a) => a.isolated)).toEqual([false, false, true]);
    const spans = arcs.map((a) => a.end - a.start);
    const free = 2 * Math.PI - 0.3;
    expect(spans[2]).toBeCloseTo(free * 0.05);
    // A and B split the rest 3:6.
    expect(spans[1] / spans[0]).toBeCloseTo(2);
    expect(spans.reduce((a, b) => a + b, 0) + 0.3).toBeCloseTo(2 * Math.PI);
    expect(ribbons).toHaveLength(1);
    expect(ribbons[0].values).toEqual([3, 6]);
    // A's whole arc is its one ribbon.
    expect(ribbons[0].source.end - ribbons[0].source.start).toBeCloseTo(spans[0]);
  });

  it("handles no themes and no sharing", () => {
    expect(chordLayout([])).toEqual({ arcs: [], ribbons: [] });
    const { arcs, ribbons } = chordLayout([[0, 0], [0, 0]], 0);
    expect(ribbons).toEqual([]);
    expect(arcs[1].end - arcs[1].start).toBeCloseTo(Math.PI);
  });
});
