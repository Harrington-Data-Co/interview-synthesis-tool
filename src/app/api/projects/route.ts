import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { codeTaken, readCode } from "@/lib/clients";
import { projectPath } from "@/lib/urls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create a project, under an existing client or a new one (with an
 *  optional short code). Returns the project's id, client id and the path
 *  of its page. */
export async function POST(request: Request) {
  try {
    const seat = await requireEditor();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
    const clientName = typeof body.clientName === "string" ? body.clientName.trim() : "";
    let clientId = typeof body.clientId === "string" ? body.clientId : "";

    if (!projectName || projectName.length > 200) throw new ApiError("Give the project a name.");
    if (clientId && !UUID.test(clientId)) throw new ApiError("Unknown client.");
    if (!clientId && (!clientName || clientName.length > 200)) throw new ApiError("Choose a client or name a new one.");

    const supabase = await createClient();
    if (!clientId) {
      const code = readCode(body.clientCode);
      const { data, error } = await supabase
        .from("client")
        .insert({ name: clientName, code, created_by: seat.user_id })
        .select("id")
        .single();
      if (error) throw error.code === "23505" ? codeTaken(code) : error;
      clientId = data.id;
    }

    const { data: project, error } = await supabase
      .from("project")
      .insert({ client_id: clientId, name: projectName, created_by: seat.user_id })
      .select("id,slug,client:client_id(slug)")
      .single();
    if (error) throw error;

    await supabase
      .from("activity")
      .insert({ project_id: project.id, actor: seat.user_id, verb: "created project", object: projectName });

    const path = projectPath((project.client as unknown as { slug: string }).slug, project.slug);
    return Response.json({ id: project.id, clientId, path });
  } catch (e) {
    return errorResponse(e);
  }
}
