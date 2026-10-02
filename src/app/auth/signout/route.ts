import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withBase } from "@/lib/basePath";

/** Sign out and go to the sign-in page: for someone signed in with an
 *  address that has no seat, who needs to try another. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL(withBase("/sign-in"), request.nextUrl.origin), { status: 303 });
}
