import { describe, expect, it } from "vitest";
import { sinceText } from "./when";

describe("sinceText", () => {
  const now = new Date("2026-10-01T12:00:00Z").getTime();
  it("says never for no sign-in", () => expect(sinceText(null, now)).toBe("never signed in"));
  it("says today", () => expect(sinceText("2026-10-01T08:00:00Z", now)).toBe("signed in today"));
  it("says yesterday", () => expect(sinceText("2026-09-30T08:00:00Z", now)).toBe("signed in yesterday"));
  it("counts days within a month", () => expect(sinceText("2026-09-21T12:00:00Z", now)).toBe("signed in 10 days ago"));
  it("gives a date after that", () => expect(sinceText("2026-06-01T12:00:00Z", now)).toBe("last signed in Jun 1, 2026"));
});
