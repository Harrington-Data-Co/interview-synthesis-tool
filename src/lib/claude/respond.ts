import Anthropic from "@anthropic-ai/sdk";
import { ClaudeError } from "./call";

/** A response for an error from a Claude pass, if it is one; null otherwise.
 *  The SDK's typed errors, most specific first. */
export function claudeErrorResponse(e: unknown): Response | null {
  if (e instanceof ClaudeError) return Response.json({ error: e.message }, { status: 502 });
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return Response.json({ error: "Claude rejected the API key. Check ANTHROPIC_API_KEY in .env.local." }, { status: 502 });
  }
  if (e instanceof Anthropic.RateLimitError) {
    return Response.json({ error: "Claude is rate-limited right now. Try again in a minute." }, { status: 503 });
  }
  if (e instanceof Anthropic.APIError) {
    console.error("[claude]", e);
    return Response.json({ error: `Claude returned an error (${e.status ?? "no status"}). Try again.` }, { status: 502 });
  }
  if (e instanceof Anthropic.AnthropicError) {
    // Raised before any request, e.g. when no credentials are configured.
    console.error("[claude]", e);
    return Response.json(
      { error: "Claude isn't set up yet: add ANTHROPIC_API_KEY to .env.local and restart the app." },
      { status: 503 },
    );
  }
  return null;
}
