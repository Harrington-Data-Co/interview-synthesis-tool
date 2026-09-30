import { describe, expect, it } from "vitest";
import { gateMaps, type MapProposal } from "./gate";
import { flowMessage, type FlowCode } from "./prompt";
import { flowResponseSchema } from "./run";

const codes: FlowCode[] = [
  { id: "c1", key: "I1:STEP-01", type: "Step", label: "Exports the grants report", verbatim: "I pull the export every quarter" },
  { id: "c2", key: "I2:STAK-01", type: "Stakeholder", label: "Finance signs off", verbatim: "then finance has to sign it" },
  { id: "c3", key: "I2:PAIN-02", type: "Pain", label: "Sign-off takes weeks", verbatim: "it sits there for two weeks" },
];

const step = (over: Partial<MapProposal["steps"][number]>) => ({ lane: "Program officer", position: 1, label: "Pulls the export", kind: "task" as const, note: "", codes: ["I1:STEP-01"], ...over });

describe("gateMaps", () => {
  it("keeps good steps, resolves lanes by name and codes by key", () => {
    const { maps, rejected } = gateMaps(
      [{ title: " Quarterly report ", scope: "From request to filing", lanes: ["Program officer", "Finance"], steps: [step({}), step({ lane: "finance", position: 2, kind: "wait", label: "Waits for sign-off", codes: ["i2:stak-01", "I2:PAIN-02"] })] }],
      codes,
    );
    expect(rejected).toEqual([]);
    expect(maps).toEqual([
      {
        title: "Quarterly report",
        scope: "From request to filing",
        lanes: ["Program officer", "Finance"],
        steps: [
          { lane: 0, position: 1, label: "Pulls the export", kind: "task", note: null, code_ids: ["c1"] },
          { lane: 1, position: 2, label: "Waits for sign-off", kind: "wait", note: null, code_ids: ["c2", "c3"] },
        ],
      },
    ]);
  });

  it("rejects, with a reason, steps the database would refuse", () => {
    const { maps, rejected } = gateMaps(
      [
        {
          title: "Quarterly report",
          scope: "",
          lanes: ["Program officer", "Finance", "Board"],
          steps: [
            step({}),
            step({ lane: "Auditor" }),
            step({ position: 2, codes: [] }),
            step({ position: 3, codes: ["I9:STEP-01"] }),
            step({ position: 0 }),
            step({ label: "Same slot" }),
          ],
        },
      ],
      codes,
    );
    expect(rejected.map((r) => r.reason)).toEqual([
      `"Auditor" isn't one of this map's lanes.`,
      "The step cites nothing.",
      "I9:STEP-01 isn't a code in this project.",
      "0 isn't a position (1, 2, 3…).",
      "Program officer already has a step at position 1.",
    ]);
    expect(rejected[0].proposal.map).toBe("Quarterly report");
    // Lanes nobody stands in are dropped, and steps re-indexed.
    expect(maps[0].lanes).toEqual(["Program officer"]);
  });

  it("drops a map with no surviving steps, and duplicate lanes", () => {
    const { maps } = gateMaps(
      [
        { title: "Empty", scope: "", lanes: ["A"], steps: [step({ lane: "A", codes: [] })] },
        { title: "Doubled", scope: "", lanes: ["Finance", "finance", " "], steps: [step({ lane: "Finance" })] },
      ],
      codes,
    );
    expect(maps.map((m) => [m.title, m.lanes])).toEqual([["Doubled", ["Finance"]]]);
  });
});

describe("flowMessage", () => {
  it("groups codes by type and says who each interview is", () => {
    const msg = flowMessage(
      { project: "PDG", client: "DOE", interviews: [{ key: "I1", role: "Program officer", organization: "Office of Early Learning" }, { key: "I2", role: null, organization: null }] },
      [{ ref: "TH-1", title: "Reporting is rebuilt by hand" }],
      codes,
    );
    expect(msg).toContain("I1: Program officer, Office of Early Learning");
    expect(msg).toContain("I2: participant");
    expect(msg).toContain("TH-1. Reporting is rebuilt by hand");
    expect(msg.indexOf("[Step]")).toBeLessThan(msg.indexOf("[Stakeholder]"));
    expect(msg).toContain("I2:PAIN-02 Sign-off takes weeks — “it sits there for two weeks”");
  });
});

describe("flowResponseSchema", () => {
  it("accepts the shape the prompt asks for and refuses an unknown kind", () => {
    const map = { title: "t", scope: "s", lanes: ["A"], steps: [{ lane: "A", position: 1, label: "x", kind: "task", note: "", codes: ["I1:STEP-01"] }] };
    expect(flowResponseSchema.safeParse({ maps: [map] }).success).toBe(true);
    expect(flowResponseSchema.safeParse({ maps: [{ ...map, steps: [{ ...map.steps[0], kind: "handoff" }] }] }).success).toBe(false);
  });
});
