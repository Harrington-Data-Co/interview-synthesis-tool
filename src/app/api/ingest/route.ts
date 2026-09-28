import { StorageApiError } from "@supabase/supabase-js";
import { readCommitFields } from "@/lib/ingest/fields";
import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { checkContentLength, readSource, sha256Hex, storagePath } from "@/lib/ingest/source";
import { parseTranscript } from "@/lib/parsers";
import { createClient } from "@/lib/supabase/server";

/** Save a previewed transcript. The file is parsed again here — lines are
 *  never accepted from the browser — and must be the same file that was
 *  previewed. The original goes to storage first, then one database call
 *  writes the transcript, its lines and speakers, or nothing. */
export async function POST(request: Request) {
  try {
    checkContentLength(request);
    await requireEditor();
    const form = await request.formData();
    const fields = readCommitFields(form);
    const source = await readSource(form);

    const sha256 = await sha256Hex(source.bytes);
    if (sha256 !== fields.expectedSha256) {
      throw new ApiError("The file changed after it was previewed. Upload it again.", 409);
    }
    const parsed = await parseTranscript(source.fileName, source.bytes);

    const supabase = await createClient();
    const path = storagePath(sha256, source.fileName);

    // Keyed by checksum, so an object already at this path is this exact file
    // (left by an earlier attempt that failed after upload). Reuse it.
    const { error: uploadError } = await supabase.storage
      .from("transcripts")
      .upload(path, source.bytes, { contentType: source.contentType, upsert: false });
    if (
      uploadError &&
      !(uploadError instanceof StorageApiError &&
        (uploadError.code === "ResourceAlreadyExists" || uploadError.status === 409))
    ) {
      throw uploadError;
    }

    const { data: id, error } = await supabase.rpc("ingest_transcript", {
      p_title: fields.title,
      p_sha256: sha256,
      p_storage_path: path,
      p_original_name: source.fileName,
      p_source: fields.source,
      p_lines: parsed.lines.map((l) => ({
        n: l.n,
        speaker: l.speaker,
        text: l.text,
        ts_start: l.tsStart,
        ts_end: l.tsEnd,
      })),
      p_speakers: Object.entries(fields.roles).map(([name, role]) => ({ name, role })),
      p_participant: fields.participant,
      p_participant_role: fields.participantRole,
      p_duration_mins:
        parsed.durationSecs === null ? null : Math.max(1, Math.round(parsed.durationSecs / 60)),
      p_recorded_on: fields.recordedOn,
      p_project_id: fields.projectId,
    });

    if (error) {
      if (error.code === "23505") throw new ApiError("This exact file is already in the library.", 409);
      throw error;
    }
    return Response.json({ id });
  } catch (e) {
    return errorResponse(e);
  }
}
