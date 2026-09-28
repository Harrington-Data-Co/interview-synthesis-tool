import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Assign a transcript to a project (or back to the library). Assigning moves
 *  a new transcript to queued; one already coded keeps its status. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const seat = await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown transcript.", 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const projectId = body.projectId === null || body.projectId === "" ? null : body.projectId;
    if (projectId !== null && (typeof projectId !== "string" || !UUID.test(projectId))) {
      throw new ApiError("Unknown project.");
    }

    const supabase = await createClient();
    const { data: current, error: readError } = await supabase
      .from("transcript")
      .select("status,title")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) throw new ApiError("Unknown transcript.", 404);

    const status =
      current.status === "coded" ? "coded" : projectId === null ? "new" : "queued";
    const { error } = await supabase
      .from("transcript")
      .update({ project_id: projectId, status })
      .eq("id", id);
    if (error) throw error;

    await supabase.from("activity").insert({
      project_id: projectId,
      actor: seat.user_id,
      verb: projectId ? "assigned" : "unassigned",
      object: current.title,
    });

    return Response.json({ ok: true, status });
  } catch (e) {
    return errorResponse(e);
  }
}
