import { ApiError } from "@/lib/api";
import { ACCEPTED_EXTENSIONS } from "@/lib/parsers";

/** Kept under the proxy's 10MB body buffer (next.config proxyClientMaxBodySize
 *  default), past which Next silently truncates the request. Real transcript
 *  exports are well under 1MB. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type Source = {
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
  pasted: boolean;
};

/** Refuse an oversized request from its header, before reading the body. */
export function checkContentLength(request: Request) {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) {
    throw new ApiError(`That file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);
  }
}

/** The transcript in a request: an uploaded file, or pasted text (saved as a
 *  .txt file so it is stored, hashed and parsed exactly like an upload). */
export async function readSource(form: FormData): Promise<Source> {
  const file = form.get("file");
  const pasted = form.get("pasted");

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(`That file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);
    }
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ApiError(`Can't read ${ext || "that file"}. Upload ${ACCEPTED_EXTENSIONS.join(", ")}, or paste the transcript.`);
    }
    return {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream",
      pasted: false,
    };
  }

  if (typeof pasted === "string" && pasted.trim()) {
    const bytes = new TextEncoder().encode(pasted);
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new ApiError("That's more text than a transcript should be.", 413);
    }
    const name = String(form.get("pastedName") ?? "").trim() || "Pasted transcript";
    return {
      fileName: `${name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 150)}.txt`,
      bytes,
      contentType: "text/plain; charset=utf-8",
      pasted: true,
    };
  }

  throw new ApiError("Choose a transcript file, or paste the transcript text.");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Storage key: the checksum plus the original extension. Keyed by content,
 *  never by the uploaded name, so the same file always lands at one path and
 *  odd filenames can't break the key. */
export function storagePath(sha256: string, fileName: string): string {
  const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  return `${sha256}${ext}`;
}
