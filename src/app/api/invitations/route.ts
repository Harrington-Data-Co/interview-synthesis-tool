import { ApiError, dbError, errorResponse, requireSeat } from "@/lib/api";
import { emailInvitation, siteOrigin } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE_ROLES = ["owner", "editor", "viewer"];
const PROJECT_ROLES = ["owner", "editor", "viewer", "client"];

/** Invite someone, by email, to a project and/or the workspace. Body:
 *  { email, name?, projectId?, projectRole?, clientAccess?, workspaceRole? }.
 *  Who may invite to what is invite_member()'s call. Someone who already has
 *  a seat is added straight away; anyone else gets an email. Returns
 *  { status: "added" | "invited", emailed?, note? }. */
export async function POST(request: Request) {
  try {
    await requireSeat();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    const projectRole = typeof body.projectRole === "string" && body.projectRole ? body.projectRole : null;
    const workspaceRole = typeof body.workspaceRole === "string" && body.workspaceRole ? body.workspaceRole : null;
    const clientAccess = body.clientAccess === "full" ? "full" : "deliverables";

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError("That doesn't look like an email address.");
    if (projectId && !UUID.test(projectId)) throw new ApiError("Unknown project.", 404);
    if (projectRole && !PROJECT_ROLES.includes(projectRole)) throw new ApiError("Unknown role.");
    if (workspaceRole && !WORKSPACE_ROLES.includes(workspaceRole)) throw new ApiError("Unknown role.");

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("invite_member", {
      p_email: email,
      p_name: name,
      p_workspace_role: workspaceRole,
      p_project_id: projectId,
      p_project_role: projectRole,
      p_client_access: clientAccess,
    });
    if (error) dbError(error);
    const result = data as { status: "added" | "invited"; invitation_id?: string };
    if (result.status === "added") return Response.json(result);

    const delivery = await emailInvitation(email, name, siteOrigin(request));
    return Response.json({ ...result, ...delivery });
  } catch (e) {
    return errorResponse(e);
  }
}
