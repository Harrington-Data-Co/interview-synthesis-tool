import { describe, expect, it } from "vitest";
import { clientPath, isViewKey, projectHref, projectPath, VIEWS, viewForSegment } from "./urls";

const base = projectPath("longwood-foundation", "ai-and-automation-opportunity-assessment");

describe("project URLs", () => {
  it("puts the project under its client", () => {
    expect(clientPath("longwood-foundation")).toBe("/clients/longwood-foundation");
    expect(base).toBe("/clients/longwood-foundation/ai-and-automation-opportunity-assessment");
  });

  it("gives Interviews the project's own URL and other tabs a segment", () => {
    expect(projectHref(base)).toBe(base);
    expect(projectHref(base, "themes")).toBe(`${base}/themes`);
    expect(projectHref(base, "swimlanes")).toBe(`${base}/process-flows`);
  });

  it("keeps a tab's settings in the query, leaving out empty ones", () => {
    expect(projectHref(base, "swimlanes", { map: "abc" })).toBe(`${base}/process-flows?map=abc`);
    expect(projectHref(base, "corpus", { facet: undefined, proposed: null })).toBe(`${base}/corpus`);
    expect(projectHref(base, "memo", { template: "a b" })).toBe(`${base}/memo?template=a+b`);
  });

  it("reads a segment back to its tab, and only real tabs", () => {
    for (const [key] of VIEWS) if (key !== "interviews") expect(viewForSegment(projectHref("", key).slice(1))).toBe(key);
    expect(viewForSegment("swimlanes")).toBeUndefined();
    expect(viewForSegment("")).toBeUndefined();
    expect(viewForSegment("print")).toBeUndefined();
  });

  it("knows the old ?view= keys, for redirecting old links", () => {
    expect(isViewKey("swimlanes")).toBe(true);
    expect(isViewKey("process-flows")).toBe(false);
    expect(isViewKey(undefined)).toBe(false);
  });
});
