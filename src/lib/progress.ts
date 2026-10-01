import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptRow } from "@/lib/library";

/** How far a project has got, step by step: the process (Interviews →
 *  Themes → Memo) and the outputs. For the project cards on the home page
 *  and a client's page. */
export type Progress = {
  interviews: number;
  minutes: number;
  latest: string | null;
  coded: number;
  /** Interviews with at least one note. */
  noted: number;
  themesConfirmed: number;
  themesProposed: number;
  memoParagraphs: number;
  flows: number;
  archMaps: number;
  deckSlides: number;
};

const empty = (): Progress => ({
  interviews: 0,
  minutes: 0,
  latest: null,
  coded: 0,
  noted: 0,
  themesConfirmed: 0,
  themesProposed: 0,
  memoParagraphs: 0,
  flows: 0,
  archMaps: 0,
  deckSlides: 0,
});

type ProductRow = { project_id: string; template: { kind: string } | null; items: { id: string }[]; slides: { id: string }[] };

/** Progress for each of these projects, from transcripts already loaded
 *  (newest recording first) plus a handful of small reads. */
export async function loadProgress(
  supabase: SupabaseClient,
  projectIds: string[],
  transcripts: TranscriptRow[],
): Promise<Map<string, Progress>> {
  const out = new Map(projectIds.map((id) => [id, empty()]));
  if (!projectIds.length) return out;
  const [{ data: notes }, { data: themes }, { data: products }, { data: flows }, { data: maps }] = await Promise.all([
    supabase.from("note").select("transcript_id"),
    supabase.from("theme").select("project_id,status").in("project_id", projectIds),
    supabase
      .from("product")
      .select("project_id,template:template_id(kind),items:product_item(id),slides:deck_slide(id)")
      .in("project_id", projectIds),
    supabase.from("flow").select("project_id").in("project_id", projectIds),
    supabase.from("arch_map").select("project_id").in("project_id", projectIds),
  ]);

  const noted = new Set((notes ?? []).map((n) => n.transcript_id));
  for (const t of transcripts) {
    const p = t.project_id ? out.get(t.project_id) : undefined;
    if (!p) continue;
    p.interviews += 1;
    p.minutes += t.duration_mins ?? 0;
    p.latest ??= t.recorded_on;
    if (t.status === "coded") p.coded += 1;
    if (noted.has(t.id)) p.noted += 1;
  }
  for (const t of themes ?? []) {
    const p = out.get(t.project_id);
    if (p) p[t.status === "confirmed" ? "themesConfirmed" : "themesProposed"] += 1;
  }
  for (const r of (products ?? []) as unknown as ProductRow[]) {
    const p = out.get(r.project_id);
    if (!p) continue;
    if (r.template?.kind === "deck") p.deckSlides += r.slides.length;
    else p.memoParagraphs += r.items.length;
  }
  for (const f of flows ?? []) {
    const p = out.get(f.project_id);
    if (p) p.flows += 1;
  }
  for (const m of maps ?? []) {
    const p = out.get(m.project_id);
    if (p) p.archMaps += 1;
  }
  return out;
}
