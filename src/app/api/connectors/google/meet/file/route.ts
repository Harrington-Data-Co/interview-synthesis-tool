import type { NextRequest } from "next/server";
import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { DOCX, docxName, exportDocx, googleToken } from "@/lib/connectors/meet";
import { createClient } from "@/lib/supabase/server";

/** One Meet transcript from Drive as a .docx, for the upload review to read
 *  exactly as if it had been downloaded and picked by hand. ?id=<Drive id> */
export async function GET(request: NextRequest) {
  try {
    await requireEditor();
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!/^[\w-]{10,200}$/.test(id)) throw new ApiError("Unknown Drive file.");
    const supabase = await createClient();
    const { name, bytes } = await exportDocx(await googleToken(supabase), id);
    const file = docxName(name);
    return new Response(bytes, {
      headers: { "Content-Type": DOCX, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}` },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
