import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { blocksDocx, blocksMarkdown } from "@/lib/export/blocks";
import { exportGuard, fileResponse, pickFormat, safeName } from "@/lib/export/file";
import { loadProjectNotesExport } from "@/lib/export/load";
import { projectNotesBlocks } from "@/lib/export/notes";
import { projectAccess } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The notes of a project's interviews in one file. ?format=md|docx (default
 *  md); ?interviews=<id>,<id> limits it to those, otherwise all. The working
 *  layer only: not for a client on deliverables-only access. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await exportGuard(id, "project");
    const params = request.nextUrl.searchParams;
    const format = pickFormat(params.get("format") ?? "md", ["md", "docx"]);
    if (!format) throw new ApiError("Notes export as Markdown (md) or Word (docx).");
    const access = await projectAccess(id);
    if (!access) throw new ApiError("Unknown project.", 404);
    if (!access.full) throw new ApiError("Notes aren't part of what's shared with you.", 403);

    const picked = params.get("interviews")?.split(",").filter(Boolean);
    if (picked?.some((p) => !UUID.test(p))) throw new ApiError("Unknown interview.", 404);
    const notes = await loadProjectNotesExport(await createClient(), id, picked);
    if (!notes) throw new ApiError("There are no notes on these interviews yet.", 404);

    const blocks = projectNotesBlocks(notes);
    const name = `${safeName(notes.project, "Project")} - Interview notes`;
    if (format === "md") return fileResponse(blocksMarkdown(blocks), name, "md");
    return fileResponse(await blocksDocx(blocks, `${notes.project} — Interview notes`, "Harrington Data Co"), name, "docx");
  } catch (e) {
    return errorResponse(e);
  }
}
