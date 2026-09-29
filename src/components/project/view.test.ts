import { describe, expect, it } from "vitest";
import { applyView, columnsFor, countsFor, EMPTY_VIEW, NONE, sanitize, type InterviewRow } from "./view";

const row = (id: string, p: Partial<InterviewRow>): InterviewRow => ({
  id,
  title: id,
  participants: [],
  organizations: [],
  recordedOn: null,
  durationMins: null,
  source: "Google Meet",
  status: "queued",
  ...p,
});

const axes = [
  {
    id: "dept",
    name: "Department",
    options: [
      { id: "lic", value: "Licensing" },
      { id: "oel", value: "Early Learning" },
    ],
  },
];
const labels = { a: { dept: "oel" }, b: { dept: "lic" }, c: { dept: "oel" } };
const rows = [
  row("a", { participants: ["Dawn"], organizations: ["DOE › OEL"], recordedOn: "2026-08-28", durationMins: 35, status: "queued" }),
  row("b", { participants: ["Elizabeth"], organizations: ["DOE › OCCL"], recordedOn: "2026-09-10", durationMins: 25, status: "coded" }),
  row("c", { participants: ["Jaquaya"], organizations: ["DOE › OEL"], recordedOn: "2026-08-31", durationMins: 62, status: "new" }),
  row("d", { participants: [], organizations: [], recordedOn: null, durationMins: null, status: "new" }),
];
const cols = columnsFor(axes, labels);
const ids = (groups: ReturnType<typeof applyView>) => groups.map((g) => [g.label, g.rows.map((r) => r.id)]);

describe("applyView", () => {
  it("sorts, with missing values last in both directions", () => {
    const asc = applyView(rows, cols, { ...EMPTY_VIEW, sort: { key: "length", dir: "asc" } });
    const desc = applyView(rows, cols, { ...EMPTY_VIEW, sort: { key: "length", dir: "desc" } });
    expect(asc[0].rows.map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(desc[0].rows.map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("groups labels in the axis's option order, unlabelled last", () => {
    expect(ids(applyView(rows, cols, { ...EMPTY_VIEW, group: "label:dept" }))).toEqual([
      ["Licensing", ["b"]],
      ["Early Learning", ["a", "c"]],
      ["Unlabelled", ["d"]],
    ]);
  });

  it("groups dates by month, newest first, and lengths by band", () => {
    expect(ids(applyView(rows, cols, { ...EMPTY_VIEW, group: "recorded" }))).toEqual([
      ["Sep 2026", ["b"]],
      ["Aug 2026", ["a", "c"]],
      ["Undated", ["d"]],
    ]);
    expect(applyView(rows, cols, { ...EMPTY_VIEW, group: "length" }).map((g) => g.label)).toEqual([
      "Under 30 min",
      "30–44 min",
      "60+ min",
      "Unknown length",
    ]);
  });

  it("filters, combining columns, and sorts within groups", () => {
    const view = {
      sort: { key: "recorded", dir: "desc" as const },
      group: "organization",
      filters: { status: ["queued", "new"] },
    };
    expect(ids(applyView(rows, cols, view))).toEqual([
      ["DOE › OEL", ["c", "a"]],
      ["No organization", ["d"]],
    ]);
  });
});

describe("countsFor", () => {
  it("counts over the other filters, ignoring the column's own", () => {
    const view = { ...EMPTY_VIEW, filters: { status: ["queued", "new"], organization: ["DOE › OEL"] } };
    expect(countsFor(rows, cols, view, "organization")).toEqual([
      { bucket: "DOE › OEL", label: "DOE › OEL", count: 2 },
      { bucket: NONE, label: "No organization", count: 1 },
    ]);
  });
});

describe("sanitize", () => {
  it("drops settings for columns that no longer exist", () => {
    const v = sanitize(
      { sort: { key: "label:gone", dir: "asc" }, group: "status", filters: { "label:gone": ["x"], status: ["new"] } },
      cols,
    );
    expect(v).toEqual({ sort: null, group: "status", filters: { status: ["new"] } });
    expect(sanitize("junk", cols)).toEqual(EMPTY_VIEW);
  });
});
