import { describe, expect, it } from "vitest";
import { withPaths } from "./directory";
import { participantOrgIds, participantsOf, type TranscriptRow } from "./library";

const row = (speakers: TranscriptRow["speakers"], participant: string | null = null): TranscriptRow => ({
  id: "t",
  title: "T",
  participant,
  source: "meet",
  duration_mins: null,
  recorded_on: null,
  status: "new",
  project_id: null,
  speakers,
});

describe("participantsOf", () => {
  it("uses participant speakers' display names, then the name as written", () => {
    const t = row([
      { name: "Jen :)", display_name: "Jennifer Koester", organization_id: null, role: "interviewer" },
      { name: "Sierra", display_name: "Sierra Harris", organization_id: "o1", role: "participant" },
      { name: "Marcus", display_name: null, organization_id: "o2", role: "participant" },
    ]);
    expect(participantsOf(t)).toBe("Sierra Harris, Marcus");
    expect(participantOrgIds(t)).toEqual(["o1", "o2"]);
  });

  it("falls back to the transcript's participant field when no speaker is marked", () => {
    expect(participantsOf(row([], "Liz Harris"))).toBe("Liz Harris");
    expect(participantsOf(row([]))).toBe("—");
  });
});

describe("withPaths", () => {
  it("builds nested paths and sorts children under their parent", () => {
    const orgs = withPaths([
      { id: "c", name: "Office of Early Learning", parent_id: "p" },
      { id: "z", name: "Profisee", parent_id: null },
      { id: "p", name: "Delaware DOE", parent_id: null },
    ]);
    expect(orgs.map((o) => o.path)).toEqual([
      "Delaware DOE",
      "Delaware DOE › Office of Early Learning",
      "Profisee",
    ]);
  });
});
