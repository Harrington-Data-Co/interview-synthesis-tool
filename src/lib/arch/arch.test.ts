import { describe, expect, it } from "vitest";
import type { FlowCode } from "@/lib/flow/prompt";
import { gateArch, type ArchProposal } from "./gate";
import { archResponseSchema } from "./run";
import { layers } from "./layout";

const codes: FlowCode[] = [
  { id: "c1", key: "I1:TOOL-01", type: "Tool", label: "Foundant", verbatim: "we use Foundant" },
  { id: "c2", key: "I1:TOOL-02", type: "Tool", label: "Monday", verbatim: "and Monday for tracking" },
  { id: "c3", key: "I2:PAIN-01", type: "Pain", label: "Re-keying", verbatim: "I key it all in twice" },
];
const sys = (name: string, codes = ["I1:TOOL-01"], official = true) => ({ name, kind: "system" as const, official, note: "", codes });

describe("gateArch", () => {
  it("resolves systems by name and codes by key", () => {
    const { maps, rejected } = gateArch(
      [{ title: "Grant data", scope: "End to end", systems: [sys("Foundant"), sys("Monday", ["I1:TOOL-02"]), sys("Board book", ["I2:PAIN-01"], false)], flows: [{ from: "foundant", to: "Monday", carries: "Award totals", manual: true, note: "", codes: ["I2:PAIN-01"] }], gaps: [{ title: "2. Nothing connects them", note: "", codes: ["i2:pain-01"] }] }],
      codes,
    );
    expect(rejected).toEqual([]);
    expect(maps[0].nodes.map((n) => [n.name, n.official])).toEqual([["Foundant", true], ["Monday", true], ["Board book", false]]);
    expect(maps[0].flows).toEqual([{ from: 0, to: 1, label: "Award totals", manual: true, note: null, code_ids: ["c3"] }]);
    expect(maps[0].gaps[0]).toMatchObject({ title: "Nothing connects them", code_ids: ["c3"] });
  });

  it("rejects, with a reason, what the database would refuse", () => {
    const p: ArchProposal = {
      title: "Grant data",
      scope: "",
      systems: [sys("Foundant"), sys("foundant"), sys("Unsupported", []), sys("Unknown code", ["I9:TOOL-01"])],
      flows: [
        { from: "Foundant", to: "Unsupported", carries: "x", manual: true, note: "", codes: ["I1:TOOL-01"] },
        { from: "Foundant", to: "Foundant", carries: "x", manual: true, note: "", codes: ["I1:TOOL-01"] },
        { from: "Foundant", to: "Monday", carries: "x", manual: true, note: "", codes: [] },
      ],
      gaps: [{ title: "", note: "", codes: ["I1:TOOL-01"] }],
    };
    const { maps, rejected } = gateArch([p], codes);
    expect(rejected.map((r) => `${r.proposal.item}: ${r.reason}`)).toEqual([
      "system: Foundant is already on the map.",
      "system: It cites nothing.",
      "system: I9:TOOL-01 isn't a code in this project.",
      "flow: Unsupported isn't a system on this map.",
      "flow: A flow must join two different systems.",
      "flow: Monday isn't a system on this map.",
      "gap: The gap has no title.",
    ]);
    expect(maps[0].nodes).toHaveLength(1);
  });

  it("drops a map with no systems", () => {
    expect(gateArch([{ title: "Empty", scope: "", systems: [sys("x", [])], flows: [], gaps: [] }], codes).maps).toEqual([]);
  });

  it("the response schema takes the six kinds only", () => {
    const m = { title: "t", scope: "", systems: [{ name: "a", kind: "system", official: true, note: "", codes: [] }], flows: [], gaps: [] };
    expect(archResponseSchema.safeParse({ maps: [m] }).success).toBe(true);
    expect(archResponseSchema.safeParse({ maps: [{ ...m, systems: [{ ...m.systems[0], kind: "cloud" }] }] }).success).toBe(false);
  });
});

describe("layers", () => {
  it("puts each system one column after what feeds it", () => {
    const L = layers(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["a", "c"]]);
    expect(L).toEqual({ a: 0, b: 1, c: 2, d: 0 });
  });
  it("survives a cycle", () => {
    const L = layers(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]]);
    expect(Object.keys(L).sort()).toEqual(["a", "b", "c"]);
    expect(Math.max(...Object.values(L))).toBeLessThanOrEqual(2);
  });
});
