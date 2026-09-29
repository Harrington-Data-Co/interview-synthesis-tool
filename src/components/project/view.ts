import type { LabelAxis, LabelMap } from "./labels";

/** One interview as the project table shows it. */
export type InterviewRow = {
  id: string;
  title: string;
  /** Participant display names; empty when none is marked. */
  participants: string[];
  /** Organization paths of the participants. */
  organizations: string[];
  recordedOn: string | null;
  durationMins: number | null;
  source: string;
  status: string;
};

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

export type Column = {
  key: string;
  name: string;
  /** The value a row groups and filters under. */
  bucket: (r: InterviewRow) => string;
  /** How a bucket reads. */
  label: (b: string) => string;
  /** Bucket order: lower first. NONE is always last regardless. */
  rank: (b: string) => number | string;
  /** Value to sort rows by; null sorts last either way. */
  sortValue: (r: InterviewRow) => number | string | null;
  /** Wording for the two sort directions. */
  sortLabels: [asc: string, desc: string];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LENGTH_BANDS = ["Under 30 min", "30–44 min", "45–59 min", "60+ min"];
const STATUS_ORDER = ["new", "queued", "coded"];

function lengthBand(mins: number | null): string {
  if (mins === null) return NONE;
  if (mins < 30) return LENGTH_BANDS[0];
  if (mins < 45) return LENGTH_BANDS[1];
  if (mins < 60) return LENGTH_BANDS[2];
  return LENGTH_BANDS[3];
}

const joined = (xs: string[]) => (xs.length ? xs.join(", ") : NONE);
const alpha = ["A → Z", "Z → A"] as [string, string];

/** The table's groupable, filterable, sortable columns, including one per
 *  label axis (grouped under the Labels header). */
export function columnsFor(axes: LabelAxis[], labels: LabelMap): Column[] {
  const base: Column[] = [
    {
      key: "participant",
      name: "Participant",
      bucket: (r) => joined(r.participants),
      label: (b) => (b === NONE ? "No participant marked" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => (r.participants.length ? r.participants.join(", ").toLowerCase() : null),
      sortLabels: alpha,
    },
    {
      key: "organization",
      name: "Organization",
      bucket: (r) => joined(r.organizations),
      label: (b) => (b === NONE ? "No organization" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => (r.organizations.length ? r.organizations.join(", ").toLowerCase() : null),
      sortLabels: alpha,
    },
    {
      key: "recorded",
      name: "Recorded",
      bucket: (r) => r.recordedOn?.slice(0, 7) ?? NONE,
      label: (b) => (b === NONE ? "Undated" : `${MONTHS[Number(b.slice(5, 7)) - 1]} ${b.slice(0, 4)}`),
      // Newest month first.
      rank: (b) => -Number(b.replace("-", "")),
      sortValue: (r) => r.recordedOn,
      sortLabels: ["Oldest first", "Newest first"],
    },
    {
      key: "length",
      name: "Length",
      bucket: (r) => lengthBand(r.durationMins),
      label: (b) => (b === NONE ? "Unknown length" : b),
      rank: (b) => LENGTH_BANDS.indexOf(b),
      sortValue: (r) => r.durationMins,
      sortLabels: ["Shortest first", "Longest first"],
    },
    {
      key: "status",
      name: "Status",
      bucket: (r) => r.status,
      label: (b) => b,
      rank: (b) => STATUS_ORDER.indexOf(b),
      sortValue: (r) => STATUS_ORDER.indexOf(r.status),
      sortLabels: ["New first", "Coded first"],
    },
  ];

  const labelCols: Column[] = axes.map((a) => {
    const optionOf = (r: InterviewRow) => a.options.find((o) => o.id === labels[r.id]?.[a.id]);
    return {
      key: `label:${a.id}`,
      name: a.name,
      bucket: (r) => optionOf(r)?.id ?? NONE,
      label: (b) => (b === NONE ? "Unlabelled" : (a.options.find((o) => o.id === b)?.value ?? "Removed option")),
      // The axis's own option order.
      rank: (b) => a.options.findIndex((o) => o.id === b),
      sortValue: (r) => optionOf(r)?.value.toLowerCase() ?? null,
      sortLabels: alpha,
    };
  });

  return [...base, ...labelCols];
}

function compareBuckets(col: Column, a: string, b: string): number {
  if (a === b) return 0;
  if (a === NONE) return 1;
  if (b === NONE) return -1;
  const ra = col.rank(a);
  const rb = col.rank(b);
  if (typeof ra === "number" && typeof rb === "number") return ra - rb;
  return String(ra).localeCompare(String(rb));
}

function sortRows(rows: InterviewRow[], col: Column | undefined, dir: "asc" | "desc"): InterviewRow[] {
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
export function filtered(rows: InterviewRow[], columns: Column[], view: View, except?: string): InterviewRow[] {
  const active = Object.entries(view.filters).filter(([k]) => k !== except);
  return rows.filter((r) =>
    active.every(([k, keep]) => {
      const col = columns.find((c) => c.key === k);
      return !col || keep.includes(col.bucket(r));
    }),
  );
}

export type Group = { bucket: string | null; label: string; rows: InterviewRow[] };

/** Filter, sort, then group. Without a grouping it's one unlabelled group. */
export function applyView(rows: InterviewRow[], columns: Column[], view: View): Group[] {
  const sortCol = view.sort ? columns.find((c) => c.key === view.sort!.key) : undefined;
  const shown = sortRows(filtered(rows, columns, view), sortCol, view.sort?.dir ?? "asc");
  const groupCol = view.group ? columns.find((c) => c.key === view.group) : undefined;
  if (!groupCol) return [{ bucket: null, label: "", rows: shown }];

  const byBucket = new Map<string, InterviewRow[]>();
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
export function countsFor(rows: InterviewRow[], columns: Column[], view: View, key: string): Count[] {
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
export function sanitize(view: unknown, columns: Column[]): View {
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
