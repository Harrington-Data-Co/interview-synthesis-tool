import { errorResponse } from "@/lib/api";
import { codingSheets } from "@/lib/export/coding";
import { exportGuard, fileResponse, safeName } from "@/lib/export/file";
import { loadCodingExport } from "@/lib/export/load";
import { workbook } from "@/lib/export/sheet";
import { createClient } from "@/lib/supabase/server";

/** The transcript with its codes beside the lines they cover, as .xlsx. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await exportGuard(id, "transcript");
    const { title, lines, codes } = await loadCodingExport(await createClient(), id);
    const buf = await workbook(codingSheets(codes, lines), "Harrington Data Co");
    return fileResponse(buf, `${safeName(title, "Transcript")} - Coding`, "xlsx");
  } catch (e) {
    return errorResponse(e);
  }
}
