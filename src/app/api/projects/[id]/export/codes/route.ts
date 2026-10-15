import { ApiError, errorResponse } from "@/lib/api";
import { codesSheets } from "@/lib/export/codes";
import { exportGuard, fileResponse, safeName } from "@/lib/export/file";
import { loadCodesExport } from "@/lib/export/load";
import { workbook } from "@/lib/export/sheet";
import { projectAccess } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Every code across the project's interviews, one workbook. The working
 *  layer only: a client on deliverables-only access doesn't get it. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await exportGuard(id, "project");
    const access = await projectAccess(id);
    if (!access) throw new ApiError("Unknown project.", 404);
    if (!access.full) throw new ApiError("Codes aren't part of what's shared with you.", 403);
    const { name, data } = await loadCodesExport(await createClient(), id);
    const buf = await workbook(codesSheets(data), "Harrington Data Co");
    return fileResponse(buf, `${safeName(name, "Project")} - Codes`, "xlsx");
  } catch (e) {
    return errorResponse(e);
  }
}
