import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_KEYS = ["title", "recorded_on", "project_id"] as const;
const SPEAKER_KEYS = ["name", "person_id", "new_person", "role", "organization_id", "title"] as const;

function pick<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, string | null>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<Record<K, string | null>> = {};
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    if (v === null || typeof v === "string") out[k] = v;
  }
  return out;
}

/** Edit a transcript's source record: its details and its speakers, never
 *  its lines. Body: { record?: {...}, speakers?: [{ name, ... }] }. A key
 *  that's present is applied (null clears it); an absent key is left alone.
 *  update_source_record() does the rest in one transaction and logs each
 *  change to edit + activity. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown transcript.", 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const record = pick(body.record, RECORD_KEYS);
    const speakers = Array.isArray(body.speakers)
      ? body.speakers.map((s) => pick(s, SPEAKER_KEYS)).filter((s) => typeof s.name === "string")
      : [];

    const supabase = await createClient();
    const { data: changes, error } = await supabase.rpc("update_source_record", {
      p_transcript_id: id,
      p_record: record,
      p_speakers: speakers,
    });
    if (error) {
      if (error.code === "P0002") throw new ApiError("Unknown transcript.", 404);
      if (error.code === "42501") throw new ApiError("Viewers can't make changes here.", 403);
      // The function's own messages are written for people.
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "22P02" || error.code === "22007" || error.code === "22008") {
        throw new ApiError("One of the values isn't valid — check the date and selections.");
      }
      if (error.code === "23503") throw new ApiError("That project, organization or person no longer exists.");
      throw error;
    }
    return Response.json({ changes });
  } catch (e) {
    return errorResponse(e);
  }
}
