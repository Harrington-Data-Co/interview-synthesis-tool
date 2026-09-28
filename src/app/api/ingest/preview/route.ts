import { buildPreview, type KnownSpeaker } from "@/lib/ingest/preview";
import { errorResponse, requireEditor } from "@/lib/api";
import { checkContentLength, readSource, sha256Hex } from "@/lib/ingest/source";
import { parseTranscript } from "@/lib/parsers";
import { createClient } from "@/lib/supabase/server";

/** Parse without saving: what the uploader confirms before anything is kept. */
export async function POST(request: Request) {
  try {
    checkContentLength(request);
    const seat = await requireEditor();
    const source = await readSource(await request.formData());
    const sha256 = await sha256Hex(source.bytes);
    const parsed = await parseTranscript(source.fileName, source.bytes);

    const supabase = await createClient();
    const { data: duplicateOf } = await supabase
      .from("transcript")
      .select("id,title")
      .eq("sha256", sha256)
      .maybeSingle();

    // The most recent record of each name, to pre-fill people seen before.
    const { data: history } = await supabase
      .from("transcript_speaker")
      .select("name,display_name,organization_id,role,set_at")
      .in("name", parsed.speakers)
      .order("set_at", { ascending: false })
      .limit(500);
    const known: Record<string, KnownSpeaker> = {};
    for (const h of history ?? []) {
      known[h.name] ??= { displayName: h.display_name, organizationId: h.organization_id, role: h.role };
    }

    return Response.json(
      buildPreview({
        parsed,
        fileName: source.fileName,
        sha256,
        pasted: source.pasted,
        uploaderName: seat.name,
        duplicateOf,
        known,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
