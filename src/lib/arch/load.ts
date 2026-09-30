import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProjectEvidence, type EvidenceCode, type EvidenceInterview } from "@/lib/themes/evidence";
import type { NodeKind } from "./prompt";

export type ArchNodeView = { id: string; name: string; kind: NodeKind; official: boolean; note: string | null; codeIds: string[] };
export type ArchFlowView = { id: string; from: string; to: string; label: string; manual: boolean; note: string | null; codeIds: string[] };
export type ArchGapView = { id: string; title: string; note: string | null; codeIds: string[] };
export type ArchMapView = {
  id: string;
  ref: string;
  title: string;
  scope: string | null;
  origin: "claude" | "human";
  touched: boolean;
  nodes: ArchNodeView[];
  flows: ArchFlowView[];
  gaps: ArchGapView[];
};
export type ArchRejectionView = { id: string; reason: string; proposal: Record<string, unknown> & { item?: string; map?: string } };
export type ArchRunView = {
  status: "running" | "done" | "failed";
  started_at: string;
  started_by: string;
  accepted: number | null;
  rejected: number | null;
  cost_usd: number | null;
  error: string | null;
};
export type LoadedArch = {
  project: { id: string; name: string; client: string | null };
  maps: ArchMapView[];
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  rejections: ArchRejectionView[];
  runs: ArchRunView[];
};

type Cites = { code_id: string }[];

/** A project's architecture maps with their systems, flows and gaps and
 *  what each cites, proposals awaiting review, recent runs, and the evidence
 *  they can cite. A citation of a code since merged away shows as the code
 *  it was merged into. */
export async function loadArch(supabase: SupabaseClient, projectId: string): Promise<LoadedArch | null> {
  const [{ data: project }, { data: mapRows }, evidence, { data: rejections }, { data: runs }, { data: seats }] = await Promise.all([
    supabase.from("project").select("id,name,client:client_id(name)").eq("id", projectId).maybeSingle(),
    supabase
      .from("arch_map")
      .select(
        "id,ref,title,scope,origin,touched,ordinal," +
          "nodes:arch_node(id,ordinal,name,kind,official,note,codes:arch_node_code(code_id))," +
          "flows:arch_flow(id,from_node,to_node,label,manual,note,codes:arch_flow_code(code_id))," +
          "gaps:arch_gap(id,ordinal,title,note,codes:arch_gap_code(code_id))",
      )
      .eq("project_id", projectId)
      .order("ordinal"),
    loadProjectEvidence(supabase, projectId),
    supabase.from("arch_rejection").select("id,reason,proposal").eq("project_id", projectId).is("resolution", null).order("created_at"),
    supabase.from("arch_run").select("status,started_at,started_by,accepted,rejected,cost_usd,error").eq("project_id", projectId).order("started_at", { ascending: false }).limit(3),
    supabase.from("seat").select("user_id,name"),
  ]);
  if (!project) return null;
  const who = new Map((seats ?? []).map((s) => [s.user_id, s.name]));

  type Row = {
    id: string; ref: string; title: string; scope: string | null; origin: ArchMapView["origin"]; touched: boolean;
    nodes: { id: string; ordinal: number; name: string; kind: NodeKind; official: boolean; note: string | null; codes: Cites }[];
    flows: { id: string; from_node: string; to_node: string; label: string; manual: boolean; note: string | null; codes: Cites }[];
    gaps: { id: string; ordinal: number; title: string; note: string | null; codes: Cites }[];
  };
  const rows = (mapRows ?? []) as unknown as Row[];

  const cited = [...new Set(rows.flatMap((m) => [...m.nodes, ...m.flows, ...m.gaps].flatMap((x) => x.codes.map((c) => c.code_id))))];
  const active = new Set(evidence.codes.map((c) => c.id));
  const current = new Map<string, string>();
  const stale = cited.filter((id) => !active.has(id));
  if (stale.length) {
    const { data } = await supabase.from("code").select("id,merged_into_id").in("id", stale);
    for (const c of data ?? []) if (c.merged_into_id) current.set(c.id, c.merged_into_id);
  }
  const ids = (cs: Cites) => [...new Set(cs.map((c) => current.get(c.code_id) ?? c.code_id))];

  const maps: ArchMapView[] = rows.map((m) => ({
    id: m.id,
    ref: m.ref,
    title: m.title,
    scope: m.scope,
    origin: m.origin,
    touched: m.touched,
    nodes: [...m.nodes].sort((a, b) => a.ordinal - b.ordinal).map((n) => ({ id: n.id, name: n.name, kind: n.kind, official: n.official, note: n.note, codeIds: ids(n.codes) })),
    flows: m.flows.map((f) => ({ id: f.id, from: f.from_node, to: f.to_node, label: f.label, manual: f.manual, note: f.note, codeIds: ids(f.codes) })),
    gaps: [...m.gaps].sort((a, b) => a.ordinal - b.ordinal).map((g) => ({ id: g.id, title: g.title, note: g.note, codeIds: ids(g.codes) })),
  }));

  const client = project.client as unknown as { name: string } | null;
  return {
    project: { id: project.id, name: project.name, client: client?.name ?? null },
    maps,
    interviews: evidence.interviews,
    codes: evidence.codes,
    rejections: (rejections ?? []) as ArchRejectionView[],
    runs: (runs ?? []).map((r) => ({ ...r, started_by: who.get(r.started_by) ?? "someone" })) as ArchRunView[],
  };
}
