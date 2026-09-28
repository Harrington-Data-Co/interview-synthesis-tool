import { TranscriptParseError } from "@/lib/parsers";
import { canEdit, currentSeat, type Seat } from "@/lib/seat";

/** An error whose message is safe and useful to show the person who caused it. */
export class ApiError extends Error {
  name = "ApiError";
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** The signed-in editor, or a 401/403. Showing a button only to editors is not
 *  a security boundary; this is. */
export async function requireEditor(): Promise<Seat> {
  const seat = await currentSeat();
  if (!seat) throw new ApiError("Sign in with a seat on this workspace.", 401);
  if (!canEdit(seat)) throw new ApiError("Viewers can't make changes here.", 403);
  return seat;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof TranscriptParseError) return Response.json({ error: e.message }, { status: 422 });
  console.error("[api]", e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}
