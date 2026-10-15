import { ApiError } from "@/lib/api";
import { currentSeat } from "@/lib/seat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every export starts here: a signed-in seat and a well-formed id. What the
 *  person may actually read is then up to row-level security. */
export async function exportGuard(id: string, what: string): Promise<void> {
  if (!(await currentSeat())) throw new ApiError("Sign in with a seat on this workspace.", 401);
  if (!UUID.test(id)) throw new ApiError(`Unknown ${what}.`, 404);
}

export const MIME = {
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export type ExportFormat = keyof typeof MIME;

/** A file name safe in a header and on every OS, without its extension. */
export function safeName(name: string, fallback: string): string {
  return name.replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100) || fallback;
}

/** A download: the bytes, typed, with a name the browser will save as. */
export function fileResponse(body: string | Uint8Array, name: string, format: ExportFormat): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "content-type": MIME[format],
      "content-disposition": `attachment; filename="${name}.${format}"`,
    },
  });
}

/** ?format= as one of the allowed formats, else a 400 for the caller to throw. */
export function pickFormat<T extends ExportFormat>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.find((f) => f === value) ?? null;
}
