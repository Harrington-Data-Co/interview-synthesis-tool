import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoRunView, MemoTemplateView, MemoThemeView } from "@/lib/memo/load";
import { loadProjectEvidence, type EvidenceCode, type EvidenceInterview } from "@/lib/themes/evidence";
import type { SlideLayout } from "./gate";

export type SlideView = {
  id: string;
  sectionId: string;
  ordinal: number;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  quoteCodeId: string | null;
  notes: string | null;
  origin: "claude" | "human";
  themeIds: string[];
  codeIds: string[];
  lastEdit: { text: string; by: string } | null;
};
export type DeckRejectionView = {
  id: string;
  reason: string;
  proposal: { section?: string; section_id?: string; layout?: string; title?: string; bullets?: string[]; quote?: string; notes?: string; themes?: string[]; codes?: string[]; theme_ids?: string[]; code_ids?: string[] };
};

export type LoadedDeck = {
  project: { id: string; name: string; client: string | null };
  templates: MemoTemplateView[];
  library: { id: string; name: string }[];
  template: MemoTemplateView | null;
  product: { id: string; title: string | null; rendered_at: string } | null;
  slides: SlideView[];
  themes: MemoThemeView[];
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  rejections: DeckRejectionView[];
  runs: MemoRunView[];
};

/** Everything the deck view and its .pptx need: the project's deck
 *  templates, the chosen one's deck and slides (in section order), and the
 *  themes and codes those slides can cite. */
export async function loadDeck(supabase: SupabaseClient, projectId: string, templateId?: string): Promise<LoadedDeck | null> {
  const [{ data: project }, { data: tplRows }, { data: library }, { data: themeRows }, evidence, { data: seats }] = await Promise.all([
    supabase.from("project").select("id,name,client:client_id(name)").eq("id", projectId).maybeSingle(),
    supabase
      .from("product_template")
      .select("id,name,scope,sections:product_section(id,ordinal,name,requires,note)")
      .eq("project_id", projectId)
      .eq("kind", "deck")
      .order("name"),
    supabase.from("product_template").select("id,name").is("project_id", null).eq("kind", "deck").order("name"),
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

  let product: LoadedDeck["product"] = null;
  let slides: SlideView[] = [];
  let rejections: DeckRejectionView[] = [];
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
  if (product && template) {
    const [{ data: rows }, { data: rej }] = await Promise.all([
      supabase
        .from("deck_slide")
        .select("id,section_id,ordinal,layout,title,bullets,quote_code_id,notes,origin,themes:deck_slide_theme(theme_id),codes:deck_slide_code(code_id)")
        .eq("product_id", product.id),
      supabase.from("product_item_rejection").select("id,reason,proposal").eq("product_id", product.id).is("resolution", null).order("created_at"),
    ]);
    const ids = (rows ?? []).map((r) => r.id);
    const lastEdit = new Map<string, SlideView["lastEdit"]>();
    if (ids.length) {
      const { data: edits } = await supabase
        .from("edit")
        .select("object_id,text,edited_by")
        .eq("object_type", "deck_slide")
        .eq("reverted", false)
        .not("before", "is", null)
        .not("after", "is", null)
        .in("object_id", ids)
        .order("edited_at", { ascending: false });
      for (const e of edits ?? []) {
        if (!lastEdit.has(e.object_id)) lastEdit.set(e.object_id, { text: e.text, by: who.get(e.edited_by) ?? "someone" });
      }
    }
    const sectionOrder = new Map(template.sections.map((s, i) => [s.id, i]));
    slides = (rows ?? [])
      .map((r) => ({
        id: r.id,
        sectionId: r.section_id,
        ordinal: r.ordinal,
        layout: r.layout as SlideLayout,
        title: r.title,
        bullets: r.bullets ?? [],
        quoteCodeId: r.quote_code_id,
        notes: r.notes,
        origin: r.origin,
        themeIds: (r.themes ?? []).map((x: { theme_id: string }) => x.theme_id),
        codeIds: (r.codes ?? []).map((x: { code_id: string }) => x.code_id),
        lastEdit: lastEdit.get(r.id) ?? null,
      }))
      .sort((a, b) => (sectionOrder.get(a.sectionId) ?? 99) - (sectionOrder.get(b.sectionId) ?? 99) || a.ordinal - b.ordinal);
    rejections = (rej ?? []) as DeckRejectionView[];
  }

  const client = project.client as unknown as { name: string } | null;
  return {
    project: { id: project.id, name: project.name, client: client?.name ?? null },
    templates,
    library: library ?? [],
    template,
    product,
    slides,
    themes,
    interviews: evidence.interviews,
    codes: evidence.codes,
    rejections,
    runs,
  };
}
