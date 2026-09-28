import { buildPreview } from "@/lib/ingest/preview";
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

    return Response.json(
      buildPreview({
        parsed,
        fileName: source.fileName,
        sha256,
        pasted: source.pasted,
        uploaderName: seat.name,
        duplicateOf,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
