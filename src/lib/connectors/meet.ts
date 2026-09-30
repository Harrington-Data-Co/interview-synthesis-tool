import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import { accessToken, openToken } from "./google";
import { parseMeetName } from "./names";

export { docxName, parseMeetName } from "./names";

/** Google Meet transcripts in Google Drive. Meet saves each as a Google Doc
 *  named "<meeting> - 2026/09/29 14:00 EDT - Transcript"; people often file
 *  them elsewhere afterwards (other folders, shared drives), so the search
 *  covers every drive the account can see rather than "Meet Recordings". */

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type MeetFile = {
  id: string;
  name: string;
  title: string;
  recordedOn: string | null; // YYYY-MM-DD
  time: string | null; // "14:00 EDT"
  createdTime: string;
  sharedDrive: boolean;
  link: string | null;
};

/** Drive's query language: a quoted, escaped literal. */
const literal = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The query for Meet transcripts, optionally narrowed by words in the name
 *  or the text. Gemini's meeting notes ("Notes by Gemini") are summaries,
 *  not transcripts, and are left out. */
export function meetQuery(search?: string): string {
  const parts = [
    "mimeType='application/vnd.google-apps.document'",
    "name contains 'Transcript'",
    "not name contains 'Notes by Gemini'",
    "trashed=false",
  ];
  for (const word of (search ?? "").split(/\s+/).filter(Boolean).slice(0, 6)) parts.push(`(name contains ${literal(word)} or fullText contains ${literal(word)})`);
  return parts.join(" and ");
}

async function drive(token: string, path: string): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return res;
  if (res.status === 401) throw new ApiError("Google no longer accepts this connection. Reconnect Google Drive.", 401);
  // Drive explains itself in error.message; 403 covers rate limits and
  // unsupported queries as well as access.
  const why = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
  throw new ApiError(`Google Drive refused the request (${res.status})${why ? `: ${why}` : ""}.`, res.status === 403 ? 403 : 502);
}

/** A fresh access token for the signed-in person's Google connection. */
export async function googleToken(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.from("connector_account").select("refresh_token_enc").eq("provider", "google").maybeSingle();
  if (error) throw new ApiError("Google Drive isn't set up here yet: apply migration 20260929e.", 503);
  if (!data) throw new ApiError("Connect Google Drive first, on the Sources page.", 409);
  return accessToken(openToken(data.refresh_token_enc));
}

/** Meet transcripts across every drive the account can see, newest first. */
export async function listMeetFiles(token: string, search?: string, pageToken?: string): Promise<{ files: MeetFile[]; next: string | null }> {
  const q = new URLSearchParams({
    q: meetQuery(search),
    corpora: "allDrives",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    pageSize: "50",
    fields: "nextPageToken,files(id,name,createdTime,driveId,webViewLink)",
  });
  // Drive can't sort a full-text search (it answers 403), so a search comes
  // back by relevance and is put in date order here.
  if (!search?.trim()) q.set("orderBy", "createdTime desc");
  if (pageToken) q.set("pageToken", pageToken);
  const body = (await (await drive(token, `files?${q}`)).json()) as {
    nextPageToken?: string;
    files: { id: string; name: string; createdTime: string; driveId?: string; webViewLink?: string }[];
  };
  return {
    files: body.files
      .map((f) => ({ id: f.id, name: f.name, ...parseMeetName(f.name), createdTime: f.createdTime, sharedDrive: !!f.driveId, link: f.webViewLink ?? null }))
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime)),
    next: body.nextPageToken ?? null,
  };
}

/** One transcript as a .docx, the same file Meet's "Download" gives. */
export async function exportDocx(token: string, fileId: string): Promise<{ name: string; bytes: ArrayBuffer }> {
  const meta = (await (await drive(token, `files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=name,mimeType`)).json()) as { name: string; mimeType: string };
  if (meta.mimeType !== "application/vnd.google-apps.document") throw new ApiError("That file isn't a Google Doc.", 400);
  const res = await drive(token, `files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(DOCX)}&supportsAllDrives=true`);
  return { name: meta.name, bytes: await res.arrayBuffer() };
}
