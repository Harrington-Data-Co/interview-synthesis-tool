import { loadFlows } from "@/lib/flow/load";
import { createClient } from "@/lib/supabase/server";
import { FlowView } from "./FlowView";

/** Loads the Swimlanes view: the project's process maps and the evidence
 *  their steps can cite. */
export async function FlowStage({ projectId, projectPath, mapId, editor }: { projectId: string; projectPath: string; mapId: string | undefined; editor: boolean }) {
  const supabase = await createClient();
  const data = await loadFlows(supabase, projectId);
  if (!data) return null;
  return <FlowView projectId={projectId} projectPath={projectPath} editor={editor} data={data} mapId={mapId} />;
}
