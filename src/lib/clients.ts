import { ApiError } from "@/lib/api";

/** Read an optional client code: trimmed, at most 20 characters, or null. */
export function readCode(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const code = v.trim();
  if (code.length > 20) throw new ApiError("Keep the code to 20 characters or fewer.");
  return code;
}

/** Explain a code that another client already has. */
export function codeTaken(code: string | null) {
  return new ApiError(`The code ${code} already belongs to another client.`, 409);
}
