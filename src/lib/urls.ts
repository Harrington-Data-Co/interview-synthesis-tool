import type { SupabaseClient } from "@supabase/supabase-js";

/** People-facing URLs (backlog R1): /clients/<client>/<project>/<tab>, built
 *  from slugs stored on client and project, so renaming either never breaks
 *  a link. API routes keep ids. */

/** A project's tabs: the key the code uses, the tab's label, and its URL
 *  segment (the label's slug, so Process Flows is /process-flows though its
 *  key is still "swimlanes"). Interviews is the project's own URL. */
export const VIEWS = [
  ["interviews", "Interviews", ""],
  ["themes", "Themes", "themes"],
  ["memo", "Memo", "memo"],
  ["deck", "Deck", "deck"],
  // Named Process Flows (Ryan, 2026-09-30); the view key stays "swimlanes".
  ["swimlanes", "Process Flows", "process-flows"],
  ["architecture", "Architecture", "architecture"],
  ["chain", "Chain", "chain"],
  ["corpus", "Corpus", "corpus"],
] as const;
export type ViewKey = (typeof VIEWS)[number][0];

export const isViewKey = (v: string | undefined): v is ViewKey => VIEWS.some(([k]) => k === v);

/** The tab a URL segment names ("process-flows" → "swimlanes"). */
export const viewForSegment = (segment: string): ViewKey | undefined => VIEWS.find(([, , s]) => s && s === segment)?.[0];

export const clientPath = (clientSlug: string) => `/clients/${clientSlug}`;
export const projectPath = (clientSlug: string, projectSlug: string) => `/clients/${clientSlug}/${projectSlug}`;

/** A tab of a project, with whatever the tab keeps in its query (map,
 *  template, interview…). Empty values are left out. */
export function projectHref(
  path: string,
  view: ViewKey = "interviews",
  params: Record<string, string | null | undefined> = {},
): string {
  const segment = VIEWS.find(([k]) => k === view)![2];
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const query = q.toString();
  return `${path}${segment ? `/${segment}` : ""}${query ? `?${query}` : ""}`;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The project at /clients/<clientSlug>/<projectSlug>, or null. */
export async function findProjectId(supabase: SupabaseClient, clientSlug: string, projectSlug: string): Promise<string | null> {
  if (!SLUG.test(clientSlug) || !SLUG.test(projectSlug)) return null;
  const { data } = await supabase
    .from("project")
    .select("id,client!inner(slug)")
    .eq("slug", projectSlug)
    .eq("client.slug", clientSlug)
    .maybeSingle();
  return data?.id ?? null;
}

/** Where an old /projects/<uuid> link now lives, or null. */
export async function pathForProjectId(supabase: SupabaseClient, id: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data } = await supabase.from("project").select("slug,client:client_id(slug)").eq("id", id).maybeSingle();
  const client = data?.client as unknown as { slug: string } | null;
  return data && client ? projectPath(client.slug, data.slug) : null;
}
