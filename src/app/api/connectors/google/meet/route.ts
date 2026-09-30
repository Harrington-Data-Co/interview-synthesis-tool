import type { NextRequest } from "next/server";
import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { docxName, googleToken, listMeetFiles } from "@/lib/connectors/meet";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Meet transcripts in the connected Google Drive, newest first, each with
 *  the transcript it became if it's been imported, or the transcript it
 *  probably is if it was downloaded and uploaded by hand before (Drive's
 *  .docx download keeps the Doc's name; its bytes differ every time, so the
 *  checksum can't tell). ?q= searches names and text; ?page= continues. */
export async function GET(request: NextRequest) {
  try {
    await requireEditor();
    const supabase = await createClient();
    const token = await googleToken(supabase);
    const q = request.nextUrl.searchParams;
    const { files, next } = await listMeetFiles(token, q.get("q")?.slice(0, 200) ?? undefined, q.get("page") ?? undefined);
    const { data: imports } = files.length
      ? await supabase.from("connector_import").select("external_id,transcript_id").eq("provider", "google").in("external_id", files.map((f) => f.id))
      : { data: [] };
    const imported = new Map((imports ?? []).map((i) => [i.external_id, i.transcript_id]));
    const { data: uploads } = files.length
      ? await supabase.from("transcript").select("id,original_name").in("original_name", files.map((f) => docxName(f.name)))
      : { data: [] };
    const uploaded = new Map((uploads ?? []).map((t) => [t.original_name as string, t.id as string]));
    return Response.json({
      files: files.map((f) => ({ ...f, transcriptId: imported.get(f.id) ?? null, uploadedId: uploaded.get(docxName(f.name)) ?? null })),
      next,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Record that a Drive file became a transcript, so it shows as imported.
 *  Body: { fileId, transcriptId } */
export async function POST(request: Request) {
  try {
    await requireEditor();
    const body = (await request.json().catch(() => ({}))) as { fileId?: unknown; transcriptId?: unknown };
    if (typeof body.fileId !== "string" || !/^[\w-]{10,200}$/.test(body.fileId)) throw new ApiError("Unknown Drive file.");
    if (typeof body.transcriptId !== "string" || !UUID.test(body.transcriptId)) throw new ApiError("Unknown transcript.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_connector_import", { p_provider: "google", p_external_id: body.fileId, p_transcript_id: body.transcriptId });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
