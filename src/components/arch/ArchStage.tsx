import { loadArch } from "@/lib/arch/load";
import { createClient } from "@/lib/supabase/server";
import { ArchView } from "./ArchView";

/** Loads the Architecture view: the project's maps and the evidence their
 *  systems, flows and gaps can cite. */
export async function ArchStage({ projectId, mapId, editor }: { projectId: string; mapId: string | undefined; editor: boolean }) {
  const supabase = await createClient();
  const data = await loadArch(supabase, projectId);
  if (!data) return null;
  return <ArchView projectId={projectId} editor={editor} data={data} mapId={mapId} />;
}
