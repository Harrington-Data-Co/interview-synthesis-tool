import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProjectEvidence, type EvidenceCode, type EvidenceInterview } from "@/lib/themes/evidence";

export type MemoTemplateView = {
  id: string;
  name: string;
  scope: string | null;
  sections: { id: string; name: string; requires: string[]; note: string | null }[];
};
export type MemoThemeView = { id: string; ref: string; title: string; status: string; codeIds: string[] };
export type ParagraphView = {
  id: string;
  sectionId: string;
  ordinal: number;
  text: string;
  origin: "claude" | "human";
  themeIds: string[];
  codeIds: string[];
  lastEdit: { text: string; by: string } | null;
};
export type MemoRejectionView = {
  id: string;
  reason: string;
  proposal: { section?: string; section_id?: string; text?: string; themes?: string[]; codes?: string[]; theme_ids?: string[]; code_ids?: string[] };
};
export type MemoRunView = {
  status: "running" | "done" | "failed";
  started_at: string;
  started_by: string;
  accepted: number | null;
  rejected: number | null;
  cost_usd: number | null;
  error: string | null;
};

export type LoadedMemo = {
  project: { id: string; name: string; client: string | null };
  templates: MemoTemplateView[];
  library: { id: string; name: string }[];
  template: MemoTemplateView | null;
  product: { id: string; title: string | null; rendered_at: string } | null;
  paragraphs: ParagraphView[];
  themes: MemoThemeView[];
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  rejections: MemoRejectionView[];
  runs: MemoRunView[];
};

/** Everything the memo view, its export and its print page need: the
 *  project's memo templates, the chosen one's memo and paragraphs, and the
 *  themes and codes those paragraphs can cite. */
export async function loadMemo(supabase: SupabaseClient, projectId: string, templateId?: string): Promise<LoadedMemo | null> {
  const [{ data: project }, { data: tplRows }, { data: library }, { data: themeRows }, evidence, { data: seats }] = await Promise.all([
    supabase.from("project").select("id,name,client:client_id(name)").eq("id", projectId).maybeSingle(),
    supabase
      .from("product_template")
      .select("id,name,scope,sections:product_section(id,ordinal,name,requires,note)")
      .eq("project_id", projectId)
      .eq("kind", "report")
      .order("name"),
    supabase.from("product_template").select("id,name").is("project_id", null).eq("kind", "report").order("name"),
    supabase.from("theme").select("id,ref,title,status,ordinal,codes:theme_code(code_id)").eq("project_id", projectId).order("ordinal"),
    loadProjectEvidence(supabase, projectId),
    supabase.from("seat").select("user_id,name"),
  ]);
  if (!project) return null;
  const who = new Map((seats ?? []).map((s) => [s.user_id, s.name]));

  const templates: MemoTemplateView[] = (tplRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    sections: [...(t.sections ?? [])]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({ id: s.id, name: s.name, requires: s.requires ?? [], note: s.note })),
  }));
  const template = templates.find((t) => t.id === templateId) ?? templates[0] ?? null;
  const active = new Set(evidence.codes.map((c) => c.id));
  const themes: MemoThemeView[] = (themeRows ?? []).map((t) => ({
    id: t.id,
    ref: t.ref,
    title: t.title,
    status: t.status,
    codeIds: (t.codes ?? []).map((c: { code_id: string }) => c.code_id).filter((id: string) => active.has(id)),
  }));

  let product: LoadedMemo["product"] = null;
  let paragraphs: ParagraphView[] = [];
  let rejections: MemoRejectionView[] = [];
  let runs: MemoRunView[] = [];
  if (template) {
    const [{ data: prod }, { data: runRows }] = await Promise.all([
      supabase.from("product").select("id,title,rendered_at").eq("project_id", projectId).eq("template_id", template.id).maybeSingle(),
      supabase
        .from("product_run")
        .select("status,started_at,started_by,accepted,rejected,cost_usd,error")
        .eq("project_id", projectId)
        .eq("template_id", template.id)
        .order("started_at", { ascending: false })
        .limit(3),
    ]);
    product = prod ?? null;
    runs = (runRows ?? []).map((r) => ({ ...r, started_by: who.get(r.started_by) ?? "someone" })) as MemoRunView[];
  }
  if (product) {
    const [{ data: items }, { data: rej }] = await Promise.all([
      supabase
        .from("product_item")
        .select("id,section_id,ordinal,text,origin,themes:product_item_theme(theme_id),codes:product_item_code(code_id)")
        .eq("product_id", product.id)
        .order("ordinal"),
      supabase
        .from("product_item_rejection")
        .select("id,reason,proposal")
        .eq("product_id", product.id)
        .is("resolution", null)
        .order("created_at"),
    ]);
    const ids = (items ?? []).map((i) => i.id);
    const lastEdit = new Map<string, ParagraphView["lastEdit"]>();
    if (ids.length) {
      const { data: edits } = await supabase
        .from("edit")
        .select("object_id,text,edited_by")
        .eq("object_type", "product_item")
        .eq("reverted", false)
        .not("before", "is", null)
        .not("after", "is", null)
        .in("object_id", ids)
        .order("edited_at", { ascending: false });
      for (const e of edits ?? []) {
        if (!lastEdit.has(e.object_id)) lastEdit.set(e.object_id, { text: e.text, by: who.get(e.edited_by) ?? "someone" });
      }
    }
    paragraphs = (items ?? []).map((i) => ({
      id: i.id,
      sectionId: i.section_id,
      ordinal: i.ordinal,
      text: i.text,
      origin: i.origin,
      themeIds: (i.themes ?? []).map((x: { theme_id: string }) => x.theme_id),
      codeIds: (i.codes ?? []).map((x: { code_id: string }) => x.code_id),
      lastEdit: lastEdit.get(i.id) ?? null,
    }));
    rejections = (rej ?? []) as MemoRejectionView[];
  }

  const client = project.client as unknown as { name: string } | null;
  return {
    project: { id: project.id, name: project.name, client: client?.name ?? null },
    templates,
    library: library ?? [],
    template,
    product,
    paragraphs,
    themes,
    interviews: evidence.interviews,
    codes: evidence.codes,
    rejections,
    runs,
  };
}
