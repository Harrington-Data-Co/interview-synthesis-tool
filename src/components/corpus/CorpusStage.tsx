import type { MatrixCell } from "@/lib/corpus/derive";
import { createClient } from "@/lib/supabase/server";
import { loadProjectEvidence } from "@/lib/themes/evidence";
import { CorpusView, type CorpusTheme, type FacetData } from "./CorpusView";

/** Loads the Corpus view: the project's coded interviews and their codes, its
 *  themes and the codes each holds, the theme × interview counts from
 *  corpus_matrix(), the facets interviews can be grouped by (each label axis,
 *  then organization), and which themes the project's memos cite. */
export async function CorpusStage({
  projectId,
  facetId,
  withProposed,
}: {
  projectId: string;
  facetId: string | undefined;
  withProposed: boolean;
}) {
  const supabase = await createClient();
  const [evidence, { data: themeRows }, { data: matrix, error }, { data: axisRows }, { data: memos }] = await Promise.all([
    loadProjectEvidence(supabase, projectId),
    supabase.from("theme").select("id,ref,title,description,status,codes:theme_code(code_id)").eq("project_id", projectId).order("ordinal"),
    supabase.rpc("corpus_matrix", { p_project_id: projectId, p_include_proposed: withProposed }),
    supabase
      .from("label_axis")
      .select("id,name,ordinal,options:label_option(id,value,ordinal)")
      .eq("project_id", projectId)
      .order("ordinal"),
    supabase
      .from("product")
      .select("id,template:product_template!inner(name,kind)")
      .eq("project_id", projectId)
      .eq("template.kind", "report"),
  ]);

  // Paragraphs citing each theme, across the project's memos.
  const cited: Record<string, number> = {};
  const memoIds = (memos ?? []).map((m) => m.id);
  if (memoIds.length) {
    const { data: items } = await supabase.from("product_item").select("themes:product_item_theme(theme_id)").in("product_id", memoIds);
    for (const i of items ?? []) for (const t of (i.themes ?? []) as { theme_id: string }[]) cited[t.theme_id] = (cited[t.theme_id] ?? 0) + 1;
  }
  const memoNames = ((memos ?? []) as unknown as { template: { name: string } }[]).map((m) => m.template.name).sort();

  const ids = evidence.interviews.map((i) => i.id);
  const facets: FacetData[] = [];
  if (axisRows?.length && ids.length) {
    const { data: tl } = await supabase
      .from("transcript_label")
      .select("transcript_id,axis_id,option_id")
      .in("axis_id", axisRows.map((a) => a.id))
      .in("transcript_id", ids);
    for (const a of axisRows) {
      const options = [...(a.options ?? [])].sort((x, y) => x.ordinal - y.ordinal);
      const value = new Map(options.map((o) => [o.id, o.value as string]));
      facets.push({
        id: a.id,
        name: a.name,
        values: options.map((o) => o.value),
        valueOf: Object.fromEntries(
          (tl ?? []).filter((l) => l.axis_id === a.id && value.has(l.option_id)).map((l) => [l.transcript_id, value.get(l.option_id)!]),
        ),
      });
    }
  }
  const orgs = evidence.interviews.filter((i) => i.organization);
  if (orgs.length) {
    facets.push({
      id: "organization",
      name: "Organization",
      values: [...new Set(orgs.map((i) => i.organization!))].sort(),
      valueOf: Object.fromEntries(orgs.map((i) => [i.id, i.organization!])),
    });
  }

  // A theme's codes, as corpus_matrix() counts them: active codes only.
  const active = new Set(evidence.codes.map((c) => c.id));
  const themes: CorpusTheme[] = (themeRows ?? [])
    .filter((t) => withProposed || t.status === "confirmed")
    .map((t) => ({
      id: t.id,
      ref: t.ref,
      title: t.title,
      description: t.description,
      proposed: t.status !== "confirmed",
      codeIds: (t.codes ?? []).map((c: { code_id: string }) => c.code_id).filter((id: string) => active.has(id)),
      memoParagraphs: cited[t.id] ?? 0,
    }));
  const cells: MatrixCell[] = (matrix ?? []).map((m: { theme_id: string | null; transcript_id: string; codes: number }) => ({
    themeId: m.theme_id,
    transcriptId: m.transcript_id,
    codes: m.codes,
  }));
  const proposedCount = (themeRows ?? []).filter((t) => t.status !== "confirmed").length;

  return (
    <CorpusView
      projectId={projectId}
      interviews={evidence.interviews}
      codes={evidence.codes}
      themes={themes}
      memoNames={memoNames}
      cells={cells}
      facets={facets}
      facetId={facetId}
      withProposed={withProposed}
      proposedCount={proposedCount}
      error={error?.message ?? null}
    />
  );
}
