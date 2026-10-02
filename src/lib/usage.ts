import { APP_TIME_ZONE } from "@/lib/when";

/** One Claude run, as usage_runs() returns it (migration 20261001a). */
export type UsageRun = {
  id: string;
  pass: string;
  project_id: string | null;
  transcript_id: string | null;
  subject: string | null;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed";
  model: string;
  served_by: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
  accepted: number | null;
  rejected: number | null;
  error: string | null;
};

export const RANGES = [
  ["30d", "Last 30 days", 30],
  ["90d", "Last 90 days", 90],
  ["12m", "Last 12 months", 365],
  ["all", "All time", null],
] as const;
export type RangeKey = (typeof RANGES)[number][0];

export const rangeFor = (key: string | undefined): (typeof RANGES)[number] => RANGES.find(([k]) => k === key) ?? RANGES[0];

/** Where a range starts, or null for all time. */
export function rangeStart(days: number | null, now = Date.now()): string | null {
  return days === null ? null : new Date(now - days * 86_400_000).toISOString();
}

export const cost = (r: Pick<UsageRun, "cost_usd">) => (r.cost_usd === null ? 0 : Number(r.cost_usd));
export const tokens = (r: Pick<UsageRun, "input_tokens" | "output_tokens">) => (r.input_tokens ?? 0) + (r.output_tokens ?? 0);

export type Slice = { key: string; label: string; spend: number; runs: number; tokens: number; other?: boolean };
export type Bucket = { key: string; label: string; spend: number; runs: number; failed: number };

export type Usage = {
  spend: number;
  runs: number;
  failed: number;
  running: number;
  people: number;
  /** Runs with no known cost (still running, or answered by a model with no price). */
  unpriced: number;
  tokens: number;
  overTime: Bucket[];
  /** "day" or "week" (weeks start Monday). */
  grain: "day" | "week";
  byProject: Slice[];
  byPerson: Slice[];
  byPass: Slice[];
};

/** The day a moment falls on in the app's time zone, as YYYY-MM-DD. */
export function dayOf(iso: string, timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** The Monday on or before a YYYY-MM-DD day. */
export function weekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Totals, spend over time and the three breakdowns, from runs already
 *  narrowed to a range (and any filter). Breakdowns keep the top `top` by
 *  spend and fold the rest into Other. */
export function summarize(
  runs: UsageRun[],
  names: { project: (id: string | null) => string; person: (id: string) => string },
  opts: { days: number | null; now?: number; top?: number } = { days: 30 },
): Usage {
  const now = opts.now ?? Date.now();
  const top = opts.top ?? 8;
  const spend = runs.reduce((s, r) => s + cost(r), 0);

  // Spend over time: every day (or week) in the range, empty ones included,
  // so gaps show as gaps. All time starts at the first run.
  const firstDay = runs.length ? runs.map((r) => dayOf(r.started_at)).sort()[0] : dayOf(new Date(now).toISOString());
  const startDay = opts.days === null ? firstDay : dayOf(new Date(now - (opts.days - 1) * 86_400_000).toISOString());
  const spanDays = Math.round((Date.parse(`${dayOf(new Date(now).toISOString())}T12:00:00Z`) - Date.parse(`${startDay}T12:00:00Z`)) / 86_400_000) + 1;
  const grain: Usage["grain"] = spanDays <= 31 ? "day" : "week";
  const buckets = new Map<string, Bucket>();
  const keyOf = (day: string) => (grain === "day" ? day : weekOf(day));
  for (let i = 0; i < spanDays; i++) {
    const day = new Date(Date.parse(`${startDay}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const k = keyOf(day);
    if (!buckets.has(k)) buckets.set(k, { key: k, label: grain === "day" ? label(k) : `Week of ${label(k)}`, spend: 0, runs: 0, failed: 0 });
  }
  for (const r of runs) {
    const b = buckets.get(keyOf(dayOf(r.started_at)));
    if (!b) continue;
    b.spend += cost(r);
    b.runs += 1;
    if (r.status === "failed") b.failed += 1;
  }

  const slices = (keyFn: (r: UsageRun) => string, labelFn: (k: string) => string): Slice[] => {
    const m = new Map<string, Slice>();
    for (const r of runs) {
      const k = keyFn(r);
      const s = m.get(k) ?? { key: k, label: labelFn(k), spend: 0, runs: 0, tokens: 0 };
      s.spend += cost(r);
      s.runs += 1;
      s.tokens += tokens(r);
      m.set(k, s);
    }
    const sorted = [...m.values()].sort((a, b) => b.spend - a.spend || b.runs - a.runs || a.label.localeCompare(b.label));
    if (sorted.length <= top) return sorted;
    const rest = sorted.slice(top - 1);
    return [
      ...sorted.slice(0, top - 1),
      {
        key: "__other__",
        label: `${rest.length} others`,
        spend: rest.reduce((s, x) => s + x.spend, 0),
        runs: rest.reduce((s, x) => s + x.runs, 0),
        tokens: rest.reduce((s, x) => s + x.tokens, 0),
        other: true,
      },
    ];
  };

  return {
    spend,
    runs: runs.length,
    failed: runs.filter((r) => r.status === "failed").length,
    running: runs.filter((r) => r.status === "running").length,
    people: new Set(runs.map((r) => r.started_by)).size,
    unpriced: runs.filter((r) => r.cost_usd === null).length,
    tokens: runs.reduce((s, r) => s + tokens(r), 0),
    overTime: [...buckets.values()],
    grain,
    byProject: slices((r) => r.project_id ?? "__none__", (k) => (k === "__none__" ? "Unassigned" : names.project(k))),
    byPerson: slices((r) => r.started_by, names.person),
    byPass: slices((r) => r.pass, (k) => k),
  };
}

/** $1,234.56; under a cent shows as <$0.01; nothing known shows as —. */
export function money(n: number | null): string {
  if (n === null) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 1,284 / 12.9K / 4.2M. */
export function compact(n: number): string {
  return n.toLocaleString("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 });
}
