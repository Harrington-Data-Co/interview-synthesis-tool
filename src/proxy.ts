import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // "/" on its own too: under a base path (/interview-synthesis) the
  // pattern below doesn't match the app's root.
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
