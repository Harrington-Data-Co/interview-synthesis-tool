import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { codeTaken, readCode } from "@/lib/clients";
import { createClient } from "@/lib/supabase/server";

/** Create a client: a name and, optionally, Ryan's short code for it. */
export async function POST(request: Request) {
  try {
    const seat = await requireEditor();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 200) throw new ApiError("Give the client a name.");
    const code = readCode(body.code);
    const supabase = await createClient();
    const { data, error } = await supabase.from("client").insert({ name, code, created_by: seat.user_id }).select("id,name,code,slug").single();
    if (error) throw error.code === "23505" ? codeTaken(code) : error;
    return Response.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}
