import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireEditor } from "@/lib/api";
import { GOOGLE_SCOPES, STATE_COOKIE, driveAccountEmail, exchangeCode, sealToken } from "@/lib/connectors/google";
import { createClient } from "@/lib/supabase/server";

/** Google sends the person back here. Check the state, trade the code for a
 *  refresh token, seal it, and save the connection; then back to Sources
 *  with a note either way. */
export async function GET(request: NextRequest) {
  const back = (q: Record<string, string>) => {
    const url = new URL("/sources", request.nextUrl.origin);
    for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/connectors/google" });
    return res;
  };
  try {
    await requireEditor();
    const q = request.nextUrl.searchParams;
    if (q.get("error")) return back({ google: "declined" });
    const state = request.cookies.get(STATE_COOKIE)?.value;
    if (!state || state !== q.get("state")) throw new ApiError("The sign-in with Google expired or didn't start here. Try again.", 400);
    const code = q.get("code");
    if (!code) throw new ApiError("Google didn't send a sign-in code. Try again.", 400);

    const tokens = await exchangeCode(request.nextUrl.origin, code);
    if (!tokens.refresh_token) throw new ApiError("Google didn't grant lasting access. Try again.", 502);
    const granted = tokens.scope.split(" ");
    if (!GOOGLE_SCOPES.every((s) => granted.includes(s))) throw new ApiError("Drive access wasn't granted. Try again and allow it.", 400);
    const email = await driveAccountEmail(tokens.access_token);

    const supabase = await createClient();
    const { error } = await supabase.rpc("save_connector_account", {
      p_provider: "google",
      p_email: email,
      p_token_enc: sealToken(tokens.refresh_token),
      p_scopes: tokens.scope,
    });
    if (error) throw new ApiError(`Couldn't save the connection: ${error.message}`, 500);
    return back({ google: "connected" });
  } catch (e) {
    console.error("[google callback]", e);
    return back({ google: "failed", reason: e instanceof ApiError ? e.message : "Something went wrong. Try again." });
  }
}
