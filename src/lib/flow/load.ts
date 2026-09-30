import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProjectEvidence, type EvidenceCode, type EvidenceInterview } from "@/lib/themes/evidence";

export type FlowStepView = {
  id: string;
  laneId: string;
  position: number;
  label: string;
  kind: "task" | "wait" | "decision";
  note: string | null;
  origin: "claude" | "human";
  codeIds: string[];
  lastEdit: { text: string; by: string } | null;
};
export type FlowView = {
  id: string;
  ref: string;
  title: string;
  scope: string | null;
  origin: "claude" | "human";
  touched: boolean;
  lanes: { id: string; name: string }[];
  steps: FlowStepView[];
};
export type FlowRejectionView = {
  id: string;
  reason: string;
  proposal: { map?: string; lane?: string | number; position?: number; label?: string; kind?: string; note?: string; codes?: string[]; code_ids?: string[] };
};
export type FlowRunView = {
  status: "running" | "done" | "failed";
  started_at: string;
  started_by: string;
  accepted: number | null;
  rejected: number | null;
  cost_usd: number | null;
  error: string | null;
};
export type LoadedFlows = {
  project: { id: string; name: string; client: string | null };
  flows: FlowView[];
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  rejections: FlowRejectionView[];
  runs: FlowRunView[];
};

/** A project's process maps (lanes, steps, citations, each step's latest
 *  revertible edit), proposals awaiting review, recent runs, and the
 *  evidence a step can cite. A citation of a code since merged away is shown
 *  as the code it was merged into. */
export async function loadFlows(supabase: SupabaseClient, projectId: string): Promise<LoadedFlows | null> {
  const [{ data: project }, { data: flowRows }, evidence, { data: rejections }, { data: runs }, { data: seats }] = await Promise.all([
    supabase.from("project").select("id,name,client:client_id(name)").eq("id", projectId).maybeSingle(),
    supabase
      .from("flow")
      .select("id,ref,title,scope,origin,touched,ordinal,lanes:flow_lane(id,name,ordinal),steps:flow_step(id,lane_id,position,label,kind,note,origin,codes:flow_step_code(code_id))")
      .eq("project_id", projectId)
      .order("ordinal"),
    loadProjectEvidence(supabase, projectId),
    supabase.from("flow_rejection").select("id,reason,proposal").eq("project_id", projectId).is("resolution", null).order("created_at"),
    supabase
      .from("flow_run")
      .select("status,started_at,started_by,accepted,rejected,cost_usd,error")
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(3),
    supabase.from("seat").select("user_id,name"),
  ]);
  if (!project) return null;
  const who = new Map((seats ?? []).map((s) => [s.user_id, s.name]));

  type StepRow = { id: string; lane_id: string; position: number; label: string; kind: FlowStepView["kind"]; note: string | null; origin: FlowStepView["origin"]; codes: { code_id: string }[] };
  type Row = { id: string; ref: string; title: string; scope: string | null; origin: FlowView["origin"]; touched: boolean; lanes: { id: string; name: string; ordinal: number }[]; steps: StepRow[] };
  const rows = (flowRows ?? []) as unknown as Row[];

  // Cited codes merged since: show the code they became.
  const cited = [...new Set(rows.flatMap((f) => f.steps.flatMap((s) => s.codes.map((c) => c.code_id))))];
  const active = new Set(evidence.codes.map((c) => c.id));
  const current = new Map<string, string>();
  const stale = cited.filter((id) => !active.has(id));
  if (stale.length) {
    const { data } = await supabase.from("code").select("id,merged_into_id").in("id", stale);
    for (const c of data ?? []) if (c.merged_into_id) current.set(c.id, c.merged_into_id);
  }
  const resolve = (id: string) => current.get(id) ?? id;

  const stepIds = rows.flatMap((f) => f.steps.map((s) => s.id));
  const lastEdit = new Map<string, FlowStepView["lastEdit"]>();
  if (stepIds.length) {
    const { data: edits } = await supabase
      .from("edit")
      .select("object_id,text,edited_by")
      .eq("object_type", "flow_step")
      .eq("reverted", false)
      .not("before", "is", null)
      .not("after", "is", null)
      .in("object_id", stepIds)
      .order("edited_at", { ascending: false });
    for (const e of edits ?? []) {
      if (!lastEdit.has(e.object_id)) lastEdit.set(e.object_id, { text: e.text, by: who.get(e.edited_by) ?? "someone" });
    }
  }

  const flows: FlowView[] = rows.map((f) => ({
    id: f.id,
    ref: f.ref,
    title: f.title,
    scope: f.scope,
    origin: f.origin,
    touched: f.touched,
    lanes: [...f.lanes].sort((a, b) => a.ordinal - b.ordinal).map((l) => ({ id: l.id, name: l.name })),
    steps: [...f.steps]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        laneId: s.lane_id,
        position: s.position,
        label: s.label,
        kind: s.kind,
        note: s.note,
        origin: s.origin,
        codeIds: [...new Set(s.codes.map((c) => resolve(c.code_id)))],
        lastEdit: lastEdit.get(s.id) ?? null,
      })),
  }));

  const client = project.client as unknown as { name: string } | null;
  return {
    project: { id: project.id, name: project.name, client: client?.name ?? null },
    flows,
    interviews: evidence.interviews,
    codes: evidence.codes,
    rejections: (rejections ?? []) as FlowRejectionView[],
    runs: (runs ?? []).map((r) => ({ ...r, started_by: who.get(r.started_by) ?? "someone" })) as FlowRunView[],
  };
}
