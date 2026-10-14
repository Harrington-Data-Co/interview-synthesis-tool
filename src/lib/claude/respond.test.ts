import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { claudeErrorResponse, isCreditExhausted } from "./respond";

const creditError = () =>
  Anthropic.APIError.generate(
    400,
    { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
    "400 Your credit balance is too low to access the Anthropic API.",
    new Headers(),
  );

describe("credit exhausted", () => {
  it("is recognized", () => {
    expect(isCreditExhausted(creditError())).toBe(true);
  });
  it("is not confused with other 400s or other errors", () => {
    const other = Anthropic.APIError.generate(400, { type: "error", error: { message: "bad" } }, "400 bad", new Headers());
    expect(isCreditExhausted(other)).toBe(false);
    expect(isCreditExhausted(new Error("credit balance is too low"))).toBe(false);
  });
  it("tells the person to top up, not to retry", async () => {
    const res = claudeErrorResponse(creditError())!;
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/out of credit/);
  });
});
