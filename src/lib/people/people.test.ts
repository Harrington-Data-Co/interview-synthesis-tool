import { describe, expect, it } from "vitest";
import { maybeSame, possibleDuplicates } from "./duplicates";
import { orgChain, topOf, withinOrg } from "@/lib/directory";
import { applyView, countsFor, EMPTY_VIEW } from "@/components/table/view";
import { partOf, peopleColumns, type PersonRow } from "@/components/people/view";

describe("maybeSame", () => {
  it("flags a first name alone, an initial, and the same full name", () => {
    expect(maybeSame("Dana", "Dana Reyes")).toBe(true);
    expect(maybeSame("Dana R.", "Dana Reyes")).toBe(true);
    expect(maybeSame("dana reyes", "Dana Reyes")).toBe(true);
    expect(maybeSame("Elizabeth (Betty) Timm", "Elizabeth Timm")).toBe(true);
  });
  it("leaves different people alone", () => {
    expect(maybeSame("Dana Reyes", "Dana Rollins")).toBe(false);
    expect(maybeSame("Dana Reyes", "Sam Reyes")).toBe(false);
    expect(maybeSame("Jen :)", "Jennifer Koester")).toBe(false);
  });
});

describe("possibleDuplicates", () => {
  it("returns everyone in a possible pair", () => {
    const ids = possibleDuplicates([
      { id: "a", name: "Dana" },
      { id: "b", name: "Dana Reyes" },
      { id: "c", name: "Sam Ortiz" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});


describe("the People table", () => {
  const iv = (role: string, date: string, client: string | null = "Longwood") => ({ id: date, title: "T", date, role, titleThen: null, orgThen: null, names: [], project: "P", client });
  const people: PersonRow[] = [
    { id: "a", name: "Dana", organizationId: null, title: null, interviews: [iv("participant", "2026-04-02")] },
    { id: "b", name: "Dana Reyes", organizationId: "o1", title: "Program officer", interviews: [iv("participant", "2026-02-01"), iv("participant", "2026-01-01", "DOE")] },
    { id: "c", name: "Ryan Harrington", organizationId: "o2", title: null, interviews: [iv("interviewer", "2026-03-01"), iv("participant", "2026-01-05")] },
    { id: "d", name: "Sam Ortiz", organizationId: "o1", title: "Controller", interviews: [] },
  ];
  const cols = peopleColumns(new Map([["o1", "Longwood › Finance"], ["o2", "Harrington Data"]]), new Set(["a", "b"]));

  it("knows each person's part across interviews", () => {
    expect(people.map(partOf)).toEqual(["participant", "participant", "both", "__none__"]);
  });
  it("groups by organization, with no organization last", () => {
    const g = applyView(people, cols, { ...EMPTY_VIEW, group: "organization" });
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([
      ["Harrington Data", ["c"]],
      ["Longwood › Finance", ["b", "d"]],
      ["No organization", ["a"]],
    ]);
  });
  it("filters to possible duplicates and counts clients", () => {
    const g = applyView(people, cols, { ...EMPTY_VIEW, filters: { duplicate: ["yes"] } });
    expect(g[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(countsFor(people, cols, EMPTY_VIEW, "clients").map((c) => [c.label, c.count])).toEqual([
      ["DOE, Longwood", 1],
      ["Longwood", 2],
      ["No client yet", 1],
    ]);
  });
});


describe("organization levels", () => {
  const orgs = [
    { id: "doe", name: "Delaware DOE", parentId: null, path: "Delaware DOE" },
    { id: "oel", name: "Office of Early Learning", parentId: "doe", path: "Delaware DOE › Office of Early Learning" },
    { id: "ccdf", name: "CCDF", parentId: "oel", path: "Delaware DOE › Office of Early Learning › CCDF" },
    { id: "hdc", name: "Harrington Data", parentId: null, path: "Harrington Data" },
  ];
  it("walks up to the top and down to everything within", () => {
    expect(orgChain("ccdf", orgs).map((o) => o.id)).toEqual(["doe", "oel", "ccdf"]);
    expect(orgChain(null, orgs)).toEqual([]);
    expect(withinOrg("doe", orgs)).toEqual(["doe", "oel", "ccdf"]);
    expect(topOf("Delaware DOE › Office of Early Learning")).toBe("Delaware DOE");
  });
});
