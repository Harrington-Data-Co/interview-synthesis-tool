import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { codeTaken, readCode } from "@/lib/clients";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set or clear a client's short code. Body: { code }. Logged to edit. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const seat = await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown client.", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const code = readCode(body.code);
    const supabase = await createClient();
    const { data: before } = await supabase.from("client").select("code").eq("id", id).maybeSingle();
    if (!before) throw new ApiError("Unknown client.", 404);
    if ((before.code ?? null) === code) return Response.json({ code });
    const { error } = await supabase.from("client").update({ code }).eq("id", id);
    if (error) throw error.code === "23505" ? codeTaken(code) : error;
    await supabase.from("edit").insert({
      object_type: "client",
      object_id: id,
      text: `code: ${before.code ? `'${before.code}'` : "empty"} → ${code ? `'${code}'` : "empty"}`,
      edited_by: seat.user_id,
    });
    return Response.json({ code });
  } catch (e) {
    return errorResponse(e);
  }
}
