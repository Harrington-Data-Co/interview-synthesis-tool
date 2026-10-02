import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api";
import { withBase } from "@/lib/basePath";

/** Google Drive, for Google Meet transcripts: Meet saves each one as a
 *  Google Doc in the organizer's Drive. Read-only: the app never changes
 *  anything in Drive. */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
export const STATE_COOKIE = "google_oauth_state";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.CONNECTOR_TOKEN_KEY);
}

function config() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new ApiError("Google isn't set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.", 503);
  return { id, secret };
}

/** Where Google sends people back to. Must match the redirect URI registered
 *  on the OAuth client exactly. */
export const redirectUri = (origin: string) => `${origin}${withBase("/api/connectors/google/callback")}`;

/** Google's consent screen. `offline` and `consent` so a refresh token comes
 *  back every time, including on a reconnect. */
export function authUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: config().id,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; scope: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant: the connection was revoked or expired; reconnecting fixes it.
    if (json.error === "invalid_grant") throw new ApiError("Google no longer accepts this connection. Reconnect Google Drive.", 401);
    throw new ApiError(`Google refused the request: ${json.error_description ?? json.error ?? res.status}.`, 502);
  }
  return json as TokenResponse;
}

/** Trade the code from the consent screen for tokens. */
export function exchangeCode(origin: string, code: string): Promise<TokenResponse> {
  const { id, secret } = config();
  return tokenRequest({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri(origin), grant_type: "authorization_code" });
}

/** A fresh access token from a stored refresh token. */
export async function accessToken(refreshToken: string): Promise<string> {
  const { id, secret } = config();
  return (await tokenRequest({ refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: "refresh_token" })).access_token;
}

/** The Google account behind a token, via Drive itself (no extra scope). */
export async function driveAccountEmail(token: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(`Couldn't read the Google account (${res.status}).`, 502);
  return ((await res.json()) as { user: { emailAddress: string } }).user.emailAddress;
}

// ─── the refresh token at rest ───────────────────────────────────────────
// Encrypted before it reaches the database, with a key only the server has,
// so a leaked row (or a mistaken read policy) doesn't leak Drive access.

function key(): Buffer {
  const raw = process.env.CONNECTOR_TOKEN_KEY;
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new ApiError("CONNECTOR_TOKEN_KEY is missing or not 32 bytes of base64 in .env.local.", 503);
  return k;
}

/** AES-256-GCM, as `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function sealToken(plain: string, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), body].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function openToken(sealed: string, k: Buffer = key()): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new ApiError("The stored Google connection is unreadable. Reconnect Google Drive.", 401);
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}
