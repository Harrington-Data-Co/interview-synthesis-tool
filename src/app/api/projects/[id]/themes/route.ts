import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const uuids = (v: unknown) => (Array.isArray(v) ? v.map((x) => uuid(x, "code")) : []);
const title = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 300) throw new ApiError("Give the theme a title.");
  return s;
};
const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000) : undefined);

/** People's changes to a project's themes, each through a database function
 *  that checks membership and logs the change with before and after values.
 *
 *  Body: { action, ... }
 *    create   { title, description?, codeIds[], rejectionId? }  → { id }  (confirmed)
 *    update   { themeId, changes: { title?, description?, codeIds? } }
 *    confirm  { themeId, confirmed: boolean }
 *    merge    { keepId, mergeIds[] }
 *    split    { themeId, codeIds[], title }                     → { id }
 *    delete   { themeId }
 *    revert   { themeId }
 *    dismiss  { rejectionId } */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id: projectId } = await ctx.params;
    if (!UUID.test(projectId)) throw new ApiError("Unknown project.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();

    const inProject = async (ids: string[]) => {
      const { count } = await supabase
        .from("theme")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .in("id", ids);
      if (count !== ids.length) throw new ApiError("That theme isn't part of this project.", 404);
    };

    let result: unknown = null;
    let error: { code?: string; message: string } | null = null;
    switch (body.action) {
      case "create":
        ({ data: result, error } = await supabase.rpc("create_theme", {
          p_project_id: projectId,
          p_title: title(body.title),
          p_description: text(body.description) ?? null,
          p_code_ids: uuids(body.codeIds),
          p_rejection_id: body.rejectionId ? uuid(body.rejectionId, "proposal") : null,
        }));
        break;
      case "update": {
        const themeId = uuid(body.themeId, "theme");
        await inProject([themeId]);
        const c = (body.changes ?? {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        if (c.title !== undefined) changes.title = title(c.title);
        if (c.description !== undefined) changes.description = text(c.description) ?? "";
        if (c.codeIds !== undefined) changes.code_ids = uuids(c.codeIds);
        ({ data: result, error } = await supabase.rpc("update_theme", { p_theme_id: themeId, p_changes: changes }));
        break;
      }
      case "confirm": {
        const themeId = uuid(body.themeId, "theme");
        await inProject([themeId]);
        ({ error } = await supabase.rpc("confirm_theme", { p_theme_id: themeId, p_confirmed: body.confirmed !== false }));
        break;
      }
      case "merge": {
        const keepId = uuid(body.keepId, "theme");
        const mergeIds = Array.isArray(body.mergeIds) ? body.mergeIds.map((m) => uuid(m, "theme")) : [];
        if (!mergeIds.length) throw new ApiError("Choose themes to merge.");
        await inProject([keepId, ...mergeIds]);
        ({ data: result, error } = await supabase.rpc("merge_themes", { p_keep: keepId, p_merge: mergeIds }));
        break;
      }
      case "split": {
        const themeId = uuid(body.themeId, "theme");
        await inProject([themeId]);
        ({ data: result, error } = await supabase.rpc("split_theme", {
          p_theme_id: themeId,
          p_code_ids: uuids(body.codeIds),
          p_title: title(body.title),
        }));
        break;
      }
      case "delete": {
        const themeId = uuid(body.themeId, "theme");
        await inProject([themeId]);
        ({ error } = await supabase.rpc("delete_theme", { p_theme_id: themeId }));
        break;
      }
      case "revert": {
        const themeId = uuid(body.themeId, "theme");
        await inProject([themeId]);
        ({ data: result, error } = await supabase.rpc("revert_last_theme_edit", { p_theme_id: themeId }));
        break;
      }
      case "dismiss": {
        const rejectionId = uuid(body.rejectionId, "proposal");
        const { count } = await supabase
          .from("theme_rejection")
          .select("id", { count: "exact", head: true })
          .eq("id", rejectionId)
          .eq("project_id", projectId);
        if (!count) throw new ApiError("That proposal isn't part of this project.", 404);
        ({ error } = await supabase.rpc("dismiss_theme_rejection", { p_rejection_id: rejectionId }));
        break;
      }
      default:
        throw new ApiError("Unknown action.");
    }

    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't change themes.", 403);
      if (error.code === "P0002") throw new ApiError("That theme no longer exists.", 404);
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "23514") throw new ApiError("A theme needs a title.");
      throw error;
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
