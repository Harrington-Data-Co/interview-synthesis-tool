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
 *  a security boundary; this is. "Editor" here means an editor somewhere: the
 *  database checks the particular project. */
export async function requireEditor(): Promise<Seat> {
  const seat = await requireSeat();
  if (!canEdit(seat)) throw new ApiError("Viewers can't make changes here.", 403);
  return seat;
}

/** The signed-in person's seat, or a 401. */
export async function requireSeat(): Promise<Seat> {
  const seat = await currentSeat();
  if (!seat) throw new ApiError("Sign in with a seat on this workspace.", 401);
  return seat;
}

/** A database refusal as something to show: the database's own message for
 *  its rules (raise exception), a 403 when it's about access, 404 for a
 *  thing that isn't there. Anything else is thrown on. */
export function dbError(error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new ApiError(error.message, 403);
  if (error.code === "P0002") throw new ApiError(error.message, 404);
  if (error.code === "P0001") throw new ApiError(error.message);
  throw error;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof TranscriptParseError) return Response.json({ error: e.message }, { status: 422 });
  // The database refusing on access (a write to a project you don't edit)
  // says why, in words meant for people.
  if (typeof e === "object" && e && (e as { code?: string }).code === "42501" && typeof (e as { message?: unknown }).message === "string")
    return Response.json({ error: (e as { message: string }).message }, { status: 403 });
  console.error("[api]", e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}
