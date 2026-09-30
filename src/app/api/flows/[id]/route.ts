import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["task", "wait", "decision"];

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const uuids = (v: unknown, what: string) => (Array.isArray(v) ? v.map((x) => uuid(x, what)) : []);
const text = (v: unknown, max = 1000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const position = (v: unknown) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new ApiError("A position is a whole number from 1.");
  return v;
};
const kind = (v: unknown) => {
  if (typeof v !== "string" || !KINDS.includes(v)) throw new ApiError("A step is a task, a wait or a decision.");
  return v;
};

/** People's changes to one process map, each through a database function
 *  that checks it and logs it.
 *
 *  Body: { action, ... }
 *    update      { changes: { title?, scope? } }
 *    delete      {}
 *    laneCreate  { name }                              → { id }
 *    laneRename  { laneId, name }
 *    laneMove    { laneId, delta: -1 | 1 }
 *    laneDelete  { laneId }
 *    stepCreate  { laneId, position, label, kind, note?, codeIds[], insert?, rejectionId? } → { id }
 *    stepUpdate  { stepId, changes: { label?, kind?, note?, laneId?, position?, codeIds? } }
 *    stepDelete  { stepId }
 *    stepRevert  { stepId }
 *    dismiss     { rejectionId } */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id: flowId } = await ctx.params;
    if (!UUID.test(flowId)) throw new ApiError("Unknown process map.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();

    const { data: flow } = await supabase.from("flow").select("id,project_id").eq("id", flowId).maybeSingle();
    if (!flow) throw new ApiError("Unknown process map.", 404);
    const inMap = async (table: "flow_lane" | "flow_step", rowId: string, what: string) => {
      const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("id", rowId).eq("flow_id", flowId);
      if (!count) throw new ApiError(`That ${what} isn't part of this map.`, 404);
      return rowId;
    };

    let result: unknown = null;
    let error: { code?: string; message: string } | null = null;
    switch (body.action) {
      case "update": {
        const c = (body.changes ?? {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        if (c.title !== undefined) changes.title = text(c.title, 300);
        if (c.scope !== undefined) changes.scope = text(c.scope);
        ({ error } = await supabase.rpc("update_flow", { p_flow_id: flowId, p_changes: changes }));
        break;
      }
      case "delete":
        ({ error } = await supabase.rpc("delete_flow", { p_flow_id: flowId }));
        break;
      case "laneCreate":
        ({ data: result, error } = await supabase.rpc("create_flow_lane", { p_flow_id: flowId, p_name: text(body.name, 120) ?? "" }));
        break;
      case "laneRename":
        ({ error } = await supabase.rpc("rename_flow_lane", {
          p_lane_id: await inMap("flow_lane", uuid(body.laneId, "lane"), "lane"),
          p_name: text(body.name, 120) ?? "",
        }));
        break;
      case "laneMove":
        ({ error } = await supabase.rpc("move_flow_lane", {
          p_lane_id: await inMap("flow_lane", uuid(body.laneId, "lane"), "lane"),
          p_delta: body.delta === -1 ? -1 : 1,
        }));
        break;
      case "laneDelete":
        ({ error } = await supabase.rpc("delete_flow_lane", { p_lane_id: await inMap("flow_lane", uuid(body.laneId, "lane"), "lane") }));
        break;
      case "stepCreate": {
        ({ data: result, error } = await supabase.rpc("create_flow_step", {
          p_flow_id: flowId,
          p_lane_id: await inMap("flow_lane", uuid(body.laneId, "lane"), "lane"),
          p_position: position(body.position),
          p_label: text(body.label, 300) ?? "",
          p_kind: kind(body.kind),
          p_note: text(body.note) ?? null,
          p_code_ids: uuids(body.codeIds, "code"),
          p_insert: body.insert !== false,
        }));
        if (!error && body.rejectionId) {
          // A proposal fixed by hand leaves the review queue.
          await supabase.rpc("dismiss_flow_rejection", { p_rejection_id: uuid(body.rejectionId, "proposal") });
        }
        break;
      }
      case "stepUpdate": {
        const stepId = await inMap("flow_step", uuid(body.stepId, "step"), "step");
        const c = (body.changes ?? {}) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        if (c.label !== undefined) changes.label = text(c.label, 300);
        if (c.kind !== undefined) changes.kind = kind(c.kind);
        if (c.note !== undefined) changes.note = text(c.note);
        if (c.laneId !== undefined) changes.lane_id = await inMap("flow_lane", uuid(c.laneId, "lane"), "lane");
        if (c.position !== undefined) changes.position = position(c.position);
        if (c.codeIds !== undefined) changes.code_ids = uuids(c.codeIds, "code");
        ({ error } = await supabase.rpc("update_flow_step", { p_step_id: stepId, p_changes: changes }));
        break;
      }
      case "stepDelete":
        ({ error } = await supabase.rpc("delete_flow_step", { p_step_id: await inMap("flow_step", uuid(body.stepId, "step"), "step") }));
        break;
      case "stepRevert":
        ({ error } = await supabase.rpc("revert_last_flow_step_edit", { p_step_id: await inMap("flow_step", uuid(body.stepId, "step"), "step") }));
        break;
      case "dismiss": {
        const rejectionId = uuid(body.rejectionId, "proposal");
        const { count } = await supabase
          .from("flow_rejection")
          .select("id", { count: "exact", head: true })
          .eq("id", rejectionId)
          .eq("project_id", flow.project_id);
        if (!count) throw new ApiError("That proposal isn't part of this project.", 404);
        ({ error } = await supabase.rpc("dismiss_flow_rejection", { p_rejection_id: rejectionId }));
        break;
      }
      default:
        throw new ApiError("Unknown action.");
    }

    if (error) {
      if (error.code === "42501") throw new ApiError("Viewers can't change process maps.", 403);
      if (error.code === "P0002") throw new ApiError("That no longer exists.", 404);
      if (error.code === "P0001") throw new ApiError(error.message);
      if (error.code === "23505") throw new ApiError("That lane already has a step at that position.", 409);
      if (error.code === "23514") throw new ApiError("That needs some text.");
      throw error;
    }
    return Response.json({ ok: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
