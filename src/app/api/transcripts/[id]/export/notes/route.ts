import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { blocksDocx, blocksMarkdown } from "@/lib/export/blocks";
import { exportGuard, fileResponse, pickFormat, safeName } from "@/lib/export/file";
import { loadNoteExport } from "@/lib/export/load";
import { noteBlocks } from "@/lib/export/notes";
import { createClient } from "@/lib/supabase/server";

/** One interview's notes as Markdown or Word. ?format=md|docx (default md);
 *  ?template=<id> picks the note, otherwise the interview's first. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await exportGuard(id, "transcript");
    const format = pickFormat(request.nextUrl.searchParams.get("format") ?? "md", ["md", "docx"]);
    if (!format) throw new ApiError("Notes export as Markdown (md) or Word (docx).");
    const template = request.nextUrl.searchParams.get("template") ?? undefined;
    const note = await loadNoteExport(await createClient(), id, template);
    if (!note) throw new ApiError("There are no notes on this interview yet.", 404);
    const blocks = noteBlocks(note);
    const name = `${safeName(note.transcript, "Interview")} - ${safeName(note.template, "Notes")}`;
    if (format === "md") return fileResponse(blocksMarkdown(blocks), name, "md");
    return fileResponse(await blocksDocx(blocks, note.transcript, "Harrington Data Co"), name, "docx");
  } catch (e) {
    return errorResponse(e);
  }
}
