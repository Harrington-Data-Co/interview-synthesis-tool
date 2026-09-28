import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientOption = { id: string; name: string };
export type ProjectOption = { id: string; name: string; clientId: string };
export type OrgOption = { id: string; name: string; parentId: string | null; path: string };

/** Clients own projects: who the work is for. Organizations are who a
 *  speaker is with — a separate, nested list, not tied to any client. */
export type Directory = {
  clients: ClientOption[];
  projects: ProjectOption[];
  organizations: OrgOption[];
};

export const PATH_SEP = " › ";

/** Full path for each organization ("Delaware DOE › Office of Early
 *  Learning"), sorted so children follow their parent. */
export function withPaths(rows: { id: string; name: string; parent_id: string | null }[]): OrgOption[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path = (id: string): string => {
    const names: string[] = [];
    for (let cur = byId.get(id), guard = 0; cur && guard < 50; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, guard++) {
      names.unshift(cur.name);
    }
    return names.join(PATH_SEP);
  };
  return rows
    .map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, path: path(r.id) }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

export async function loadDirectory(supabase: SupabaseClient): Promise<Directory> {
  const [{ data: clients }, { data: projects }, { data: orgs }] = await Promise.all([
    supabase.from("client").select("id,name").order("name"),
    supabase.from("project").select("id,name,client_id").order("name"),
    supabase.from("organization").select("id,name,parent_id"),
  ]);
  return {
    clients: clients ?? [],
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name, clientId: p.client_id })),
    organizations: withPaths(orgs ?? []),
  };
}
