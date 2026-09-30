import { describe, expect, it } from "vitest";
import { maybeSame, possibleDuplicates } from "./duplicates";
import { outlineSize, parseOutline } from "./outline";
import { kindColumns } from "@/components/table/kindColumns";
import { kindsInUse, nearestOfKind, orgChain, orgLabel, topOf, withinOrg, withPaths } from "@/lib/directory";
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
  const orgs = withPaths([
    { id: "doe", name: "Delaware DOE", parent_id: null, kind: "Department", short_name: "DOE" },
    { id: "oel", name: "Office of Early Learning", parent_id: "doe", kind: "Office" },
    { id: "ccdf", name: "CCDF", parent_id: "oel", kind: "unit" },
    { id: "occl", name: "OCCL", parent_id: "doe", kind: "office" },
    { id: "hdc", name: "Harrington Data", parent_id: null, kind: "Company" },
  ]);
  it("walks up to the top and down to everything within", () => {
    expect(orgChain("ccdf", orgs).map((o) => o.id)).toEqual(["doe", "oel", "ccdf"]);
    expect(orgChain(null, orgs)).toEqual([]);
    expect(withinOrg("doe", orgs).sort()).toEqual(["ccdf", "doe", "occl", "oel"]);
    expect(topOf("Delaware DOE › Office of Early Learning")).toBe("Delaware DOE");
  });
  it("finds the nearest organization of a kind, and orders kinds outermost first", () => {
    expect(nearestOfKind("ccdf", "office", orgs)?.id).toBe("oel");
    expect(nearestOfKind("ccdf", "Department", orgs)?.id).toBe("doe");
    expect(nearestOfKind("hdc", "Department", orgs)).toBeUndefined();
    expect(kindsInUse(orgs)).toEqual(["Company", "Department", "Office", "unit"]);
    expect(orgLabel(orgs.find((o) => o.id === "doe")!)).toBe("Delaware DOE (DOE)");
  });
});

describe("parseOutline", () => {
  it("nests by indentation and reads short names and kinds", () => {
    const tree = parseOutline(
      [
        "State of Delaware [Government]",
        "  - Department of Education (DOE) [Department]",
        "      Office of Early Learning (OEL)",
        "          Early Childhood Assessment [Unit]",
        "      [Office] Office of Child Care Licensing (OCCL)",
        "  Department of Health and Social Services [Department] (DHSS)",
        "",
        "Harrington Data",
      ].join("\n"),
      ["", "", "Office"],
    );
    expect(tree.map((n) => n.name)).toEqual(["State of Delaware", "Harrington Data"]);
    const doe = tree[0].children[0];
    expect(doe).toMatchObject({ name: "Department of Education", short_name: "DOE", kind: "Department" });
    expect(doe.children.map((n) => [n.name, n.short_name, n.kind])).toEqual([
      ["Office of Early Learning", "OEL", "Office"],
      ["[Office] Office of Child Care Licensing", "OCCL", "Office"],
    ]);
    expect(doe.children[0].children[0]).toMatchObject({ name: "Early Childhood Assessment", kind: "Unit" });
    expect(tree[0].children[1]).toMatchObject({ name: "Department of Health and Social Services", short_name: "DHSS", kind: "Department" });
    expect(outlineSize(tree)).toEqual({ count: 7, depth: 4 });
  });
});


describe("grouping by organization kind", () => {
  const orgs = withPaths([
    { id: "sod", name: "State of Delaware", parent_id: null, kind: "Government" },
    { id: "doe", name: "Department of Education", parent_id: "sod", short_name: "DOE", kind: "Department" },
    { id: "oel", name: "Office of Early Learning", parent_id: "doe", kind: "Office" },
    { id: "eca", name: "Early Childhood Assessment", parent_id: "oel", kind: "Unit" },
    { id: "dhss", name: "Department of Health and Social Services", parent_id: "sod", short_name: "DHSS", kind: "Department" },
    { id: "hdc", name: "Harrington Data", parent_id: null },
  ]);
  const rows = [
    { id: "a", orgs: ["eca"] },
    { id: "b", orgs: ["oel"] },
    { id: "c", orgs: ["dhss"] },
    { id: "d", orgs: ["hdc"] },
    { id: "e", orgs: ["eca", "dhss"] },
  ];
  const cols = kindColumns<(typeof rows)[number]>(orgs, (r) => r.orgs);
  it("adds a column per kind, outermost first, and groups under the nearest one", () => {
    expect(cols.map((c) => c.name)).toEqual(["Government", "Department", "Office", "Unit"]);
    const byDept = applyView(rows, cols, { ...EMPTY_VIEW, group: "kind:department" });
    expect(byDept.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["Department of Education (DOE)", ["a", "b"]],
      ["Department of Education (DOE), Department of Health and Social Services (DHSS)", ["e"]],
      ["Department of Health and Social Services (DHSS)", ["c"]],
      ["No department", ["d"]],
    ]);
  });
});
