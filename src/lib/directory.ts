import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientOption = { id: string; name: string };
export type ProjectOption = { id: string; name: string; clientId: string };
export type OrgOption = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  /** The acronym people say (DOE, OEL). */
  shortName: string | null;
  /** What this layer is: Agency, Department, Division, Unit… */
  kind: string | null;
};
/** An organization as the database returns it. */
export type OrgRow = { id: string; name: string; parent_id: string | null; short_name?: string | null; kind?: string | null };
/** Someone who speaks in interviews, with their current organization and
 *  title (from their most recent interview, or as last edited). */
export type PersonOption = { id: string; name: string; organizationId: string | null; title: string | null };

/** Clients own projects: who the work is for. Organizations are who a
 *  speaker is with — a separate, nested list, not tied to any client. */
export type Directory = {
  clients: ClientOption[];
  projects: ProjectOption[];
  organizations: OrgOption[];
  people: PersonOption[];
};

export const PATH_SEP = " › ";

/** Full path for each organization ("Delaware DOE › Office of Early
 *  Learning"), sorted so children follow their parent. */
export function withPaths(rows: OrgRow[]): OrgOption[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path = (id: string): string => {
    const names: string[] = [];
    for (let cur = byId.get(id), guard = 0; cur && guard < 50; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, guard++) {
      names.unshift(cur.name);
    }
    return names.join(PATH_SEP);
  };
  return rows
    .map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, path: path(r.id), shortName: r.short_name ?? null, kind: r.kind ?? null }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

export const toOrgRow = (o: OrgOption): OrgRow => ({ id: o.id, name: o.name, parent_id: o.parentId, short_name: o.shortName, kind: o.kind });

/** The list with one more organization (just created), paths recomputed. */
export const addOrg = (orgs: OrgOption[], row: OrgRow): OrgOption[] => withPaths([...orgs.map(toOrgRow), row]);

/** "Office of Early Learning (OEL)". */
export const orgLabel = (o: Pick<OrgOption, "name" | "shortName">) => (o.shortName ? `${o.name} (${o.shortName})` : o.name);

/** The nearest organization of a kind at or above this one: someone in a
 *  unit of the Office of Early Learning is under the Department of
 *  Education. Kinds match ignoring case. */
export function nearestOfKind(id: string | null | undefined, kind: string, orgs: OrgOption[]): OrgOption | undefined {
  const k = kind.toLowerCase();
  return orgChain(id, orgs)
    .reverse()
    .find((o) => o.kind?.toLowerCase() === k);
}

/** The kinds in use, outermost first (by how deep they usually sit), so
 *  Agency comes before Department before Unit. */
export function kindsInUse(orgs: OrgOption[]): string[] {
  const depths = new Map<string, { name: string; total: number; n: number }>();
  for (const o of orgs) {
    if (!o.kind) continue;
    const d = orgChain(o.id, orgs).length;
    const e = depths.get(o.kind.toLowerCase()) ?? { name: o.kind, total: 0, n: 0 };
    // Show the capitalised spelling when both are in use ("Office", not "office").
    if (/^\p{Lu}/u.test(o.kind) && !/^\p{Lu}/u.test(e.name)) e.name = o.kind;
    e.total += d;
    e.n += 1;
    depths.set(o.kind.toLowerCase(), e);
  }
  return [...depths.values()].sort((a, b) => a.total / a.n - b.total / b.n || a.name.localeCompare(b.name)).map((e) => e.name);
}

/** The top-level organization of a path: "Delaware DOE" for
 *  "Delaware DOE › Office of Early Learning". */
export const topOf = (path: string) => path.split(PATH_SEP)[0];

/** An organization and its parents, top level first. */
export function orgChain(id: string | null | undefined, orgs: OrgOption[]): OrgOption[] {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const chain: OrgOption[] = [];
  for (let cur = id ? byId.get(id) : undefined, guard = 0; cur && guard < 50; cur = cur.parentId ? byId.get(cur.parentId) : undefined, guard++) {
    chain.unshift(cur);
  }
  return chain;
}

/** An organization and everything under it, at any depth. */
export function withinOrg(id: string, orgs: OrgOption[]): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const o of orgs) if (o.parentId === out[i]) out.push(o.id);
  return out;
}

export async function loadDirectory(supabase: SupabaseClient): Promise<Directory> {
  const [{ data: clients }, { data: projects }, { data: orgs }, { data: people }] = await Promise.all([
    supabase.from("client").select("id,name").order("name"),
    supabase.from("project").select("id,name,client_id").order("name"),
    supabase.from("organization").select("id,name,parent_id,short_name,kind"),
    supabase.from("person").select("id,name,organization_id,title").order("name"),
  ]);
  return {
    clients: clients ?? [],
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name, clientId: p.client_id })),
    organizations: withPaths(orgs ?? []),
    people: (people ?? []).map((p) => ({ id: p.id, name: p.name, organizationId: p.organization_id, title: p.title })),
  };
}
