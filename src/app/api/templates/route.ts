import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { STARTER_TEMPLATE } from "@/lib/notes/starter";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = ["Pain", "Step", "Tool", "Goal", "Constraint", "Question", "Quote", "Stakeholder"];

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ApiError(`Unknown ${what}.`);
  return v;
};
const name = (v: unknown, what: string) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 120) throw new ApiError(`Give the ${what} a name.`);
  return s;
};
const types = (v: unknown) => {
  if (!Array.isArray(v) || !v.every((t) => TYPES.includes(t))) throw new ApiError("Unknown code type.");
  return [...new Set(v as string[])];
};
const longText = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 2000) || null : null);

/** Note templates: the library (no project) and project copies.
 *
 *  Body: { action, ... }
 *    starter                                  → { id }  the Discovery interview template, into the library
 *    create     { name, scope?, projectId? }  → { id }
 *    update     { templateId, name?, scope? }
 *    duplicate  { templateId }                → { id }  a copy alongside the original
 *    addToProject { templateId, projectId }   → { id }  the project's own copy
 *    delete     { templateId }                — refused while notes use it
 *    addSection { templateId, name, requires[], note? }
 *    updateSection { sectionId, name?, requires?, note? }
 *    moveSection   { sectionId, delta: -1 | 1 }
 *    removeSection { sectionId }              — refused while note items sit in it */
export async function POST(request: Request) {
  try {
    const seat = await requireEditor();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const supabase = await createClient();
    let id: string | undefined;

    const insertTemplate = async (tName: string, scope: string | null, projectId: string | null) => {
      const { data, error } = await supabase
        .from("note_template")
        .insert({ name: tName, scope, project_id: projectId, created_by: seat.user_id })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    };
    const templateOf = async (sectionId: string) => {
      const { data } = await supabase.from("note_section").select("template_id,ordinal").eq("id", sectionId).maybeSingle();
      if (!data) throw new ApiError("Unknown section.", 404);
      return data;
    };

    switch (body.action) {
      case "starter": {
        id = await insertTemplate(STARTER_TEMPLATE.name, STARTER_TEMPLATE.scope, null);
        const { error } = await supabase.from("note_section").insert(
          STARTER_TEMPLATE.sections.map((s, i) => ({
            template_id: id,
            ordinal: i + 1,
            name: s.name,
            requires: s.requires,
            note: s.note,
            created_by: seat.user_id,
          })),
        );
        if (error) throw error;
        break;
      }
      case "create": {
        const projectId = body.projectId ? uuid(body.projectId, "project") : null;
        id = await insertTemplate(name(body.name, "template"), longText(body.scope), projectId);
        break;
      }
      case "update": {
        const templateId = uuid(body.templateId, "template");
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) patch.name = name(body.name, "template");
        if (body.scope !== undefined) patch.scope = longText(body.scope);
        const { error } = await supabase.from("note_template").update(patch).eq("id", templateId);
        if (error) throw error;
        break;
      }
      case "duplicate":
      case "addToProject": {
        const templateId = uuid(body.templateId, "template");
        let projectId: string | null;
        if (body.action === "addToProject") {
          projectId = uuid(body.projectId, "project");
        } else {
          const { data } = await supabase.from("note_template").select("project_id").eq("id", templateId).maybeSingle();
          if (!data) throw new ApiError("Unknown template.", 404);
          projectId = data.project_id;
        }
        const { data, error } = await supabase.rpc("copy_note_template", { p_template_id: templateId, p_project_id: projectId });
        if (error) throw error;
        id = data as string;
        break;
      }
      case "delete": {
        const templateId = uuid(body.templateId, "template");
        const { error } = await supabase.from("note_template").delete().eq("id", templateId);
        if (error) {
          if (error.code === "23503") throw new ApiError("Notes use this template, so it can't be deleted.", 409);
          throw error;
        }
        break;
      }
      case "addSection": {
        const templateId = uuid(body.templateId, "template");
        const { data: last } = await supabase
          .from("note_section")
          .select("ordinal")
          .eq("template_id", templateId)
          .order("ordinal", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { error } = await supabase.from("note_section").insert({
          template_id: templateId,
          ordinal: (last?.ordinal ?? 0) + 1,
          name: name(body.name, "section"),
          requires: types(body.requires ?? []),
          note: longText(body.note),
          created_by: seat.user_id,
        });
        if (error) throw error;
        break;
      }
      case "updateSection": {
        const sectionId = uuid(body.sectionId, "section");
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) patch.name = name(body.name, "section");
        if (body.requires !== undefined) patch.requires = types(body.requires);
        if (body.note !== undefined) patch.note = longText(body.note);
        const { error } = await supabase.from("note_section").update(patch).eq("id", sectionId);
        if (error) throw error;
        break;
      }
      case "moveSection": {
        const sectionId = uuid(body.sectionId, "section");
        const me = await templateOf(sectionId);
        const up = body.delta === -1;
        const { data: other } = await supabase
          .from("note_section")
          .select("id,ordinal")
          .eq("template_id", me.template_id)
          [up ? "lt" : "gt"]("ordinal", me.ordinal)
          .order("ordinal", { ascending: !up })
          .limit(1)
          .maybeSingle();
        if (other) {
          // Two updates; the (template, ordinal) uniqueness is checked at commit
          // in the database, but PostgREST commits each call — so park one first.
          const park = -me.ordinal;
          for (const [sid, ord] of [
            [sectionId, park],
            [other.id, me.ordinal],
            [sectionId, other.ordinal],
          ] as const) {
            const { error } = await supabase.from("note_section").update({ ordinal: ord }).eq("id", sid);
            if (error) throw error;
          }
        }
        break;
      }
      case "removeSection": {
        const sectionId = uuid(body.sectionId, "section");
        const { error } = await supabase.from("note_section").delete().eq("id", sectionId);
        if (error) {
          if (error.code === "23503") throw new ApiError("Note items sit in this section, so it can't be removed. Move them first.", 409);
          throw error;
        }
        break;
      }
      default:
        throw new ApiError("Unknown action.");
    }
    return Response.json({ ok: true, id });
  } catch (e) {
    return errorResponse(e);
  }
}
