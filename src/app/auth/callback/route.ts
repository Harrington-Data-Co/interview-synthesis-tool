import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withBase } from "@/lib/basePath";

/** Magic-link landing. Exchanges the code for a session, then sends the person
 *  on. Whether they actually have a seat is decided by the app layout — a valid
 *  Supabase user with no seat row is still not a member of this workspace. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${withBase(next.startsWith("/") && !next.startsWith("//") ? next : "/")}`);
  }

  return NextResponse.redirect(`${origin}${withBase("/sign-in")}?error=link`);
}
