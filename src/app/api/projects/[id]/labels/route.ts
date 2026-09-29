import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown, what: string, max = 120) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > max) throw new ApiError(`Give the ${what} a name.`);
  return s;
};
const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "label";

/** A project's labels: the axes it groups interviews by (department, level,
 *  region…), their options, and which option each transcript has.
 *
 *  Body: { action, ... }
 *    addAxis      { name }              → { id }
 *    renameAxis   { axisId, name }
 *    removeAxis   { axisId }            — removes its labels too
 *    addOption    { axisId, value }     → { id }
 *    renameOption { optionId, value }
 *    removeOption { optionId }          — removes its labels too
 *    apply        { axisId, optionId | null, transcriptIds[] }  — null clears */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const seat = await requireEditor();
    const { id: projectId } = await ctx.params;
    if (!UUID.test(projectId)) throw new ApiError("Unknown project.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();

    // Every axis and option touched must belong to this project.
    const axisInProject = async (axisId: string) => {
      const { data } = await supabase
        .from("label_axis")
        .select("id,name")
        .eq("id", axisId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (!data) throw new ApiError("That label isn't part of this project.", 404);
      return data;
    };
    const optionInProject = async (optionId: string) => {
      const { data: opt } = await supabase.from("label_option").select("axis_id").eq("id", optionId).maybeSingle();
      if (!opt) throw new ApiError("Unknown option.", 404);
      await axisInProject(opt.axis_id);
    };
    const duplicateOption = (value: string) => new ApiError(`“${value}” is already an option.`, 409);
    let created: string | undefined;

    switch (body.action) {
      case "addAxis": {
        const name = str(body.name, "label");
        const { data: existing } = await supabase.from("label_axis").select("key,ordinal").eq("project_id", projectId);
        const keys = new Set((existing ?? []).map((a) => a.key));
        let key = slug(name);
        for (let n = 2; keys.has(key); n++) key = `${slug(name)}-${n}`;
        const ordinal = Math.max(-1, ...(existing ?? []).map((a) => a.ordinal)) + 1;
        const { data, error } = await supabase
          .from("label_axis")
          .insert({ project_id: projectId, key, name, ordinal, created_by: seat.user_id })
          .select("id")
          .single();
        if (error) throw error;
        created = data.id;
        break;
      }
      case "renameAxis": {
        const axis = await axisInProject(uuid(body.axisId, "label"));
        const { error } = await supabase.from("label_axis").update({ name: str(body.name, "label") }).eq("id", axis.id);
        if (error) throw error;
        break;
      }
      case "removeAxis": {
        const axis = await axisInProject(uuid(body.axisId, "label"));
        const { error } = await supabase.from("label_axis").delete().eq("id", axis.id);
        if (error) throw error;
        break;
      }
      case "addOption": {
        const axis = await axisInProject(uuid(body.axisId, "label"));
        const value = str(body.value, "option");
        const { data: existing } = await supabase.from("label_option").select("ordinal").eq("axis_id", axis.id);
        const ordinal = Math.max(-1, ...(existing ?? []).map((o) => o.ordinal)) + 1;
        const { data, error } = await supabase
          .from("label_option")
          .insert({ axis_id: axis.id, value, ordinal, created_by: seat.user_id })
          .select("id")
          .single();
        if (error) {
          if (error.code === "23505") throw duplicateOption(value);
          throw error;
        }
        created = data.id;
        break;
      }
      case "renameOption": {
        const optionId = uuid(body.optionId, "option");
        await optionInProject(optionId);
        const value = str(body.value, "option");
        const { error } = await supabase.from("label_option").update({ value }).eq("id", optionId);
        if (error) {
          if (error.code === "23505") throw duplicateOption(value);
          throw error;
        }
        break;
      }
      case "removeOption": {
        const optionId = uuid(body.optionId, "option");
        await optionInProject(optionId);
        const { error } = await supabase.from("label_option").delete().eq("id", optionId);
        if (error) throw error;
        break;
      }
      case "apply": {
        const axis = await axisInProject(uuid(body.axisId, "label"));
        const optionId = body.optionId === null ? null : uuid(body.optionId, "option");
        const ids = Array.isArray(body.transcriptIds) ? body.transcriptIds.map((t) => uuid(t, "transcript")) : [];
        if (!ids.length || ids.length > 500) throw new ApiError("Choose between 1 and 500 transcripts.");

        if (optionId === null) {
          const { error } = await supabase
            .from("transcript_label")
            .delete()
            .eq("axis_id", axis.id)
            .in("transcript_id", ids);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("transcript_label").upsert(
            ids.map((t) => ({
              transcript_id: t,
              axis_id: axis.id,
              option_id: optionId,
              set_by: seat.user_id,
              set_at: new Date().toISOString(),
            })),
            { onConflict: "transcript_id,axis_id" },
          );
          if (error) {
            // The database's own refusals (another project's label, an option
            // from another axis) are written for people.
            if (error.code === "P0001") throw new ApiError(error.message);
            if (error.code === "23503") throw new ApiError("That option isn't one of this label's options.");
            throw error;
          }
        }
        const { data: opt } = optionId
          ? await supabase.from("label_option").select("value").eq("id", optionId).maybeSingle()
          : { data: null };
        await supabase.from("activity").insert({
          project_id: projectId,
          actor: seat.user_id,
          verb: optionId ? "labelled" : "cleared label on",
          object: `${ids.length} transcript${ids.length === 1 ? "" : "s"} · ${axis.name}${opt ? `: ${opt.value}` : ""}`,
        });
        break;
      }
      default:
        throw new ApiError("Unknown action.");
    }
    return Response.json({ ok: true, id: created });
  } catch (e) {
    return errorResponse(e);
  }
}
