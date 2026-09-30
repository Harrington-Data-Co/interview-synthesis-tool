/** The shared table engine: how a table is sorted, grouped and filtered,
 *  over any kind of row. The project's Interviews table and the People
 *  table both use it, with their own columns. */

/** How the table is sorted, grouped and filtered. `filters[key]` lists the
 *  buckets kept; a column with no entry isn't filtered. */
export type View = {
  sort: { key: string; dir: "asc" | "desc" } | null;
  group: string | null;
  filters: Record<string, string[]>;
};

export const EMPTY_VIEW: View = { sort: null, group: null, filters: {} };

/** The bucket for "no value" — always ordered last. */
export const NONE = "__none__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Column<R = any> = {
  key: string;
  name: string;
  /** The value a row groups and filters under. */
  bucket: (r: R) => string;
  /** How a bucket reads. */
  label: (b: string) => string;
  /** Bucket order: lower first. NONE is always last regardless. */
  rank: (b: string) => number | string;
  /** Value to sort rows by; null sorts last either way. */
  sortValue: (r: R) => number | string | null;
  /** Wording for the two sort directions. */
  sortLabels: [asc: string, desc: string];
};

function compareBuckets<R>(col: Column<R>, a: string, b: string): number {
  if (a === b) return 0;
  if (a === NONE) return 1;
  if (b === NONE) return -1;
  const ra = col.rank(a);
  const rb = col.rank(b);
  if (typeof ra === "number" && typeof rb === "number") return ra - rb;
  return String(ra).localeCompare(String(rb));
}

function sortRows<R>(rows: R[], col: Column<R> | undefined, dir: "asc" | "desc"): R[] {
  if (!col) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = col.sortValue(x);
    const b = col.sortValue(y);
    if (a === null && b === null) return 0;
    if (a === null) return 1; // missing values last, in both directions
    if (b === null) return -1;
    return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))) * sign;
  });
}

/** Rows kept by every filter except, optionally, one column's own. */
export function filtered<R>(rows: R[], columns: Column<R>[], view: View, except?: string): R[] {
  const active = Object.entries(view.filters).filter(([k]) => k !== except);
  return rows.filter((r) =>
    active.every(([k, keep]) => {
      const col = columns.find((c) => c.key === k);
      return !col || keep.includes(col.bucket(r));
    }),
  );
}

export type Group<R> = { bucket: string | null; label: string; rows: R[] };

/** Filter, sort, then group. Without a grouping it's one unlabelled group. */
export function applyView<R>(rows: R[], columns: Column<R>[], view: View): Group<R>[] {
  const sortCol = view.sort ? columns.find((c) => c.key === view.sort!.key) : undefined;
  const shown = sortRows(filtered(rows, columns, view), sortCol, view.sort?.dir ?? "asc");
  const groupCol = view.group ? columns.find((c) => c.key === view.group) : undefined;
  if (!groupCol) return [{ bucket: null, label: "", rows: shown }];

  const byBucket = new Map<string, R[]>();
  for (const r of shown) {
    const b = groupCol.bucket(r);
    byBucket.set(b, [...(byBucket.get(b) ?? []), r]);
  }
  return [...byBucket.keys()]
    .sort((a, b) => compareBuckets(groupCol, a, b))
    .map((b) => ({ bucket: b, label: groupCol.label(b), rows: byBucket.get(b)! }));
}

export type Count = { bucket: string; label: string; count: number };

/** Count per bucket of one column, over the rows the other filters keep —
 *  so filtering to one value doesn't hide the others from the list. */
export function countsFor<R>(rows: R[], columns: Column<R>[], view: View, key: string): Count[] {
  const col = columns.find((c) => c.key === key);
  if (!col) return [];
  const counts = new Map<string, number>();
  for (const r of filtered(rows, columns, view, key)) counts.set(col.bucket(r), (counts.get(col.bucket(r)) ?? 0) + 1);
  return [...counts.keys()]
    .sort((a, b) => compareBuckets(col, a, b))
    .map((b) => ({ bucket: b, label: col.label(b), count: counts.get(b)! }));
}

/** Drop view settings that refer to columns or buckets that no longer exist
 *  (a removed label, say), so a remembered view can't break the table. */
export function sanitize<R>(view: unknown, columns: Column<R>[]): View {
  if (!view || typeof view !== "object") return EMPTY_VIEW;
  const v = view as Partial<View>;
  const known = (k: unknown): k is string => typeof k === "string" && columns.some((c) => c.key === k);
  const sort =
    v.sort && known(v.sort.key) && (v.sort.dir === "asc" || v.sort.dir === "desc") ? { key: v.sort.key, dir: v.sort.dir } : null;
  const filters: Record<string, string[]> = {};
  for (const [k, keep] of Object.entries(v.filters ?? {})) {
    if (known(k) && Array.isArray(keep) && keep.every((b) => typeof b === "string")) filters[k] = keep;
  }
  return { sort, group: known(v.group) ? v.group : null, filters };
}
