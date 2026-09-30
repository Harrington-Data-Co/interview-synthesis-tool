import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authUrl, openToken, sealToken } from "./google";

describe("stored Google tokens", () => {
  const key = randomBytes(32);

  it("round-trips, and differs every time it's sealed", () => {
    const a = sealToken("1//refresh-token", key);
    const b = sealToken("1//refresh-token", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(openToken(a, key)).toBe("1//refresh-token");
  });

  it("refuses the wrong key and a tampered token", () => {
    const sealed = sealToken("secret", key);
    expect(() => openToken(sealed, randomBytes(32))).toThrow();
    const [v, iv, tag, body] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() => openToken([v, iv, tag, flipped.toString("base64url")].join("."), key)).toThrow();
    expect(() => openToken("garbage", key)).toThrow(/Reconnect/);
  });
});

describe("the consent screen", () => {
  it("asks for read-only Drive, offline access and a fresh consent", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    const url = new URL(authUrl("http://localhost:3000", "state-123"));
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/connectors/google/callback");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.toString()).not.toContain("client-secret");
  });
});
