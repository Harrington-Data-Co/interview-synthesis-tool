import { describe, expect, it } from "vitest";
import { dayOf, money, summarize, weekOf, type UsageRun } from "./usage";

const run = (over: Partial<UsageRun>): UsageRun => ({
  id: Math.random().toString(),
  pass: "Coding",
  project_id: "p1",
  transcript_id: null,
  subject: null,
  started_by: "u1",
  started_at: "2026-09-30T15:00:00Z",
  finished_at: null,
  status: "done",
  model: "claude-opus-5-5",
  served_by: "claude-opus-5-5",
  input_tokens: 100,
  output_tokens: 20,
  cost_usd: "0.50",
  accepted: 1,
  rejected: 0,
  error: null,
  ...over,
});
const names = { project: (id: string | null) => `Project ${id}`, person: (id: string) => `Person ${id}` };
const now = Date.parse("2026-10-01T16:00:00Z");

describe("summarize", () => {
  it("totals spend, runs, failures and people", () => {
    const u = summarize([run({}), run({ status: "failed", cost_usd: null, started_by: "u2" }), run({ cost_usd: 1.25 })], names, { days: 30, now });
    expect(u.spend).toBeCloseTo(1.75);
    expect(u.runs).toBe(3);
    expect(u.failed).toBe(1);
    expect(u.people).toBe(2);
    expect(u.unpriced).toBe(1);
    expect(u.tokens).toBe(360);
  });

  it("buckets by day within a month, every day present", () => {
    const u = summarize([run({ started_at: "2026-09-30T15:00:00Z" }), run({ started_at: "2026-10-01T14:00:00Z" })], names, { days: 30, now });
    expect(u.grain).toBe("day");
    expect(u.overTime).toHaveLength(30);
    expect(u.overTime.at(-1)).toMatchObject({ key: "2026-10-01", runs: 1 });
    expect(u.overTime.at(-2)).toMatchObject({ key: "2026-09-30", runs: 1 });
  });

  it("buckets by week beyond a month", () => {
    const u = summarize([run({})], names, { days: 90, now });
    expect(u.grain).toBe("week");
    expect(u.overTime.every((b) => new Date(`${b.key}T12:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(u.overTime.reduce((s, b) => s + b.runs, 0)).toBe(1);
  });

  it("folds past the top into Other, and names unassigned", () => {
    const runs = Array.from({ length: 10 }, (_, i) => run({ project_id: `p${i}`, cost_usd: 10 - i }));
    runs.push(run({ project_id: null, cost_usd: 0 }));
    const u = summarize(runs, names, { days: 30, now, top: 4 });
    expect(u.byProject.map((s) => s.label)).toEqual(["Project p0", "Project p1", "Project p2", "8 others"]);
    expect(u.byProject.at(-1)?.other).toBe(true);
    expect(summarize([run({ project_id: null })], names, { days: 30, now }).byProject[0].label).toBe("Unassigned");
  });
});

describe("dates and money", () => {
  it("days fall in the app's time zone", () => expect(dayOf("2026-10-01T02:00:00Z", "America/New_York")).toBe("2026-09-30"));
  it("weeks start Monday", () => expect(weekOf("2026-10-01")).toBe("2026-09-28"));
  it("formats money", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(0.004)).toBe("<$0.01");
    expect(money(null)).toBe("—");
  });
});
