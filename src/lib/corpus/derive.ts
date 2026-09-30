/** The corpus views, derived from corpus_matrix(): one cell per theme per
 *  interview (a null theme counts the interview's unthemed codes). Pure, so
 *  the rules below are tested without a database. */

export type MatrixCell = { themeId: string | null; transcriptId: string; codes: number };

/** A way to group interviews: a label axis, or the participant's
 *  organization. `valueOf` maps an interview to its value on this facet. */
export type Facet = { id: string; name: string; values: string[]; valueOf: Map<string, string> };

export type Band = { name: string; ids: string[]; labelled: boolean };

export const UNLABELLED = "Unlabelled";

/** A band with this many interviews or fewer is too thin to call a pattern
 *  inside it a finding. */
export const THIN = 2;

/** Interviews grouped by the facet's values, in the facet's order, with the
 *  ones that carry no value last. Within a band, the given order holds. With
 *  no facet, one band holds everything. */
export function groupColumns(ids: string[], facet: Facet | null): Band[] {
  if (!facet) return ids.length ? [{ name: "All interviews", ids, labelled: false }] : [];
  const bands: Band[] = facet.values
    .map((v) => ({ name: v, ids: ids.filter((id) => facet.valueOf.get(id) === v), labelled: true }))
    .filter((b) => b.ids.length);
  const rest = ids.filter((id) => !facet.valueOf.has(id));
  if (rest.length) bands.push({ name: UNLABELLED, ids: rest, labelled: false });
  return bands;
}

export type ThemeRow = { themeId: string; counts: Map<string, number>; codes: number; ivs: number };

/** Theme references in their natural order, numbers compared as numbers:
 *  TH-2 before TH-12. */
export const compareRefs = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** One row per theme with its per-interview counts, in the order the themes
 *  are given. Themes no interview supports still get a row, so an empty
 *  theme shows as empty. */
export function themeRows(themeIds: string[], cells: MatrixCell[]): ThemeRow[] {
  const rows = new Map(themeIds.map((id) => [id, { themeId: id, counts: new Map<string, number>(), codes: 0, ivs: 0 }]));
  for (const c of cells) {
    const row = c.themeId ? rows.get(c.themeId) : undefined;
    if (!row || c.codes <= 0) continue;
    row.counts.set(c.transcriptId, (row.counts.get(c.transcriptId) ?? 0) + c.codes);
  }
  for (const row of rows.values()) {
    row.codes = [...row.counts.values()].reduce((a, b) => a + b, 0);
    row.ivs = row.counts.size;
  }
  return [...rows.values()];
}

/** Unthemed codes per interview. */
export function unthemed(cells: MatrixCell[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cells) if (!c.themeId) out.set(c.transcriptId, (out.get(c.transcriptId) ?? 0) + c.codes);
  return out;
}

/** The one labelled band a row's support sits entirely inside, if it does
 *  and there is more than one band to compare against. That row is the
 *  group's view, not a finding. */
export function singleBand(row: ThemeRow, bands: Band[]): string | null {
  if (bands.length < 2 || !row.ivs) return null;
  const home = bands.filter((b) => b.ids.some((id) => row.counts.has(id)));
  return home.length === 1 && home[0].labelled ? home[0].name : null;
}

export type SaturationBar = { id: string; fresh: number; seen: number };

/** New themes per interview, in the order given (recording order): a theme
 *  is new in the first interview that holds any of its codes. `seen` is the
 *  running total. */
export function saturation(ids: string[], rows: ThemeRow[]): SaturationBar[] {
  const counted = new Set<string>();
  let seen = 0;
  return ids.map((id) => {
    let fresh = 0;
    for (const r of rows) {
      if (!counted.has(r.themeId) && r.counts.has(id)) {
        counted.add(r.themeId);
        fresh++;
      }
    }
    seen += fresh;
    return { id, fresh, seen };
  });
}

/** What the saturation bars say, in a sentence. */
export function saturationNote(bars: SaturationBar[], keyOf: (id: string) => string): string {
  const total = bars.at(-1)?.seen ?? 0;
  if (!total) return "No themes rest on these interviews yet. Propose and confirm themes to see when new interviews stop adding new ones.";
  let quiet = 0;
  for (let i = bars.length - 1; i >= 0 && bars[i].fresh === 0; i--) quiet++;
  if (quiet >= 2)
    return `The last ${quiet} interviews added no new theme. That is the usual signal to stop recruiting, unless a group below is thin.`;
  const last = bars.at(-1)!;
  if (quiet === 1)
    return `${keyOf(last.id)} added no new theme. One more quiet interview would make it a trend rather than a pause.`;
  return `${keyOf(last.id)} still added ${last.fresh} new theme${last.fresh === 1 ? "" : "s"}. Saturation isn't reached; keep interviewing.`;
}

export type BandCoverage = { name: string; ivs: number; codes: number; share: number; thin: boolean };

/** How many interviews and codes each band carries, and which bands are too
 *  thin to hold a finding on their own. */
export function bandCoverage(bands: Band[], codesOf: (id: string) => number): BandCoverage[] {
  const total = bands.reduce((a, b) => a + b.ids.length, 0);
  return bands.map((b) => ({
    name: b.name,
    ivs: b.ids.length,
    codes: b.ids.reduce((a, id) => a + codesOf(id), 0),
    share: total ? b.ids.length / total : 0,
    thin: b.labelled && b.ids.length <= THIN,
  }));
}

/** What the coverage bars say, in a sentence. */
export function coverageNote(coverage: BandCoverage[], facetName: string | null): string {
  if (!facetName) return "Add a label axis to this project, or set participants' organizations, to see coverage by group.";
  const labelled = coverage.filter((c) => c.name !== UNLABELLED);
  if (!labelled.length) return `No interview carries a ${facetName.toLowerCase()} yet. Label interviews on the Interviews tab.`;
  const thin = labelled.filter((c) => c.thin).map((c) => c.name);
  if (!thin.length)
    return "Every group carries three or more interviews, so a theme that fills across groups can be called a finding rather than one group's view.";
  const list = thin.length > 1 ? `${thin.slice(0, -1).join(", ")} and ${thin.at(-1)}` : thin[0];
  return `${list} ${thin.length > 1 ? "carry" : "carries"} two interviews or fewer. A theme resting mostly inside ${
    thin.length > 1 ? "those groups" : "that group"
  } is a lead, not a finding.`;
}
