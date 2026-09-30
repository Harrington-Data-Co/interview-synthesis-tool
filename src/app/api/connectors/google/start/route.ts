import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, requireEditor } from "@/lib/api";
import { STATE_COOKIE, authUrl } from "@/lib/connectors/google";

/** Send the person to Google's consent screen. A random state, kept in an
 *  httpOnly cookie, ties the callback to this browser. */
export async function GET(request: NextRequest) {
  try {
    await requireEditor();
    const state = randomBytes(24).toString("base64url");
    const res = NextResponse.redirect(authUrl(request.nextUrl.origin, state));
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/api/connectors/google",
      maxAge: 600,
    });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
