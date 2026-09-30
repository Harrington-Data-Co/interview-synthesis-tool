import { buildPreview, type KnownSpeaker, type SpeakerRole } from "@/lib/ingest/preview";
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
    const [{ data: history }, { data: people }] = await Promise.all([
      supabase
        .from("transcript_speaker")
        .select("name,display_name,organization_id,title,role,person_id,set_at")
        .in("name", parsed.speakers)
        .order("set_at", { ascending: false })
        .limit(500),
      supabase.from("person").select("id,name,organization_id,title"),
    ]);
    const known: Record<string, KnownSpeaker> = {};
    for (const h of history ?? []) {
      known[h.name] ??= {
        personId: h.person_id,
        displayName: h.display_name,
        organizationId: h.organization_id,
        title: h.title,
        role: h.role as SpeakerRole,
      };
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
        people: (people ?? []).map((p) => ({ id: p.id, name: p.name, organizationId: p.organization_id, title: p.title })),
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
