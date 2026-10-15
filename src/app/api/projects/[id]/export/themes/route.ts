import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { blocksDocx, blocksMarkdown } from "@/lib/export/blocks";
import { exportGuard, fileResponse, pickFormat, safeName } from "@/lib/export/file";
import { loadThemesExport } from "@/lib/export/load";
import { workbook } from "@/lib/export/sheet";
import { themeBlocks, themeSheets } from "@/lib/export/themes";
import { projectAccess } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** The project's themes with their supporting quotes. ?format=md|docx|xlsx
 *  (default md). Themes are a deliverable, so clients may export them too. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await exportGuard(id, "project");
    const format = pickFormat(request.nextUrl.searchParams.get("format") ?? "md", ["md", "docx", "xlsx"]);
    if (!format) throw new ApiError("Themes export as Markdown (md), Word (docx) or Excel (xlsx).");
    if (!(await projectAccess(id))) throw new ApiError("Unknown project.", 404);
    const themes = await loadThemesExport(await createClient(), id);
    const name = `${safeName(themes.project, "Project")} - Themes`;
    if (format === "xlsx") return fileResponse(await workbook(themeSheets(themes), "Harrington Data Co"), name, "xlsx");
    const blocks = themeBlocks(themes);
    if (format === "md") return fileResponse(blocksMarkdown(blocks), name, "md");
    return fileResponse(await blocksDocx(blocks, `Themes — ${themes.project}`, "Harrington Data Co"), name, "docx");
  } catch (e) {
    return errorResponse(e);
  }
}
