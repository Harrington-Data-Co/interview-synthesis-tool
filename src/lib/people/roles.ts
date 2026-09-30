import type { SupabaseClient } from "@supabase/supabase-js";

/** Who said each code, as their title at the time (the speaker of the code's
 *  first line), for attributing quotes by role, never by name. Codes whose
 *  speaker has no title are absent. */
export async function quoteRoles(supabase: SupabaseClient, projectId: string): Promise<Map<string, string>> {
  const { data } = await supabase.rpc("code_speakers", { p_project_id: projectId });
  return new Map(((data ?? []) as { code_id: string; title: string | null }[]).filter((r) => r.title).map((r) => [r.code_id, r.title as string]));
}
