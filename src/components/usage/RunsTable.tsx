"use client";

import { useState } from "react";
import { ColumnMenu } from "@/components/table/ColumnMenu";
import { GroupRows, HeaderButton, ViewChips } from "@/components/table/parts";
import { useSavedView } from "@/components/table/useSavedView";
import { applyView, EMPTY_VIEW, NONE, sanitize, type Column } from "@/components/table/view";
import { compact, money, PASSES } from "@/lib/usage";

/** One run, as the server prepared it: plain data only (a server page can't
 *  hand functions to this component). */
export type RunRow = {
  id: string;
  at: string;
  when: string;
  /** The day it ran on, YYYY-MM-DD in the app's time zone. */
  day: string;
  pass: string;
  subject: string | null;
  project: string;
  client: string | null;
  person: string;
  model: string;
  /** Who answered, when a fallback did. */
  answeredBy: string | null;
  tokens: number | null;
  cost: number | null;
  status: "running" | "done" | "failed";
  kept: number;
  review: number;
  error: string | null;
  /** Keys the dashboard's drawer narrows by ("__none__" when there's none). */
  projectId: string;
  clientId: string;
  personId: string;
  /** The spend-over-time column it falls in. */
  bucket: string;
};

const OUTCOME: Record<RunRow["status"], string> = { done: "Done", failed: "Failed", running: "Running" };

// Cost and tokens group into ranges, so grouping and filtering by them means something.
const COST_BANDS: [string, number][] = [
  ["Under $0.10", 0.1],
  ["$0.10 – $1", 1],
  ["$1 – $5", 5],
  ["$5 and up", Infinity],
];
const TOKEN_BANDS: [string, number][] = [
  ["Under 10K", 10_000],
  ["10K – 100K", 100_000],
  ["100K – 1M", 1_000_000],
  ["1M and up", Infinity],
];
const band = (n: number | null, bands: [string, number][]) => (n === null ? NONE : bands.find(([, top]) => n < top)![0]);
const bandRank = (bands: [string, number][]) => (b: string) => bands.findIndex(([l]) => l === b);

const text = (key: keyof RunRow, name: string, none = "—"): Column<RunRow> => ({
  key,
  name,
  bucket: (r) => (r[key] as string | null) ?? NONE,
  label: (b) => (b === NONE ? none : b),
  rank: (b) => b.toLowerCase(),
  sortValue: (r) => ((r[key] as string | null) ?? null)?.toLowerCase() ?? null,
  sortLabels: ["A to Z", "Z to A"],
});

const COLUMNS: Column<RunRow>[] = [
  {
    key: "when",
    name: "When",
    bucket: (r) => r.day,
    label: (b) => new Date(`${b}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    // Newest day first when grouped.
    rank: (b) => -Date.parse(`${b}T12:00:00Z`),
    sortValue: (r) => r.at,
    sortLabels: ["Oldest first", "Newest first"],
  },
  {
    key: "pass",
    name: "Pass",
    bucket: (r) => r.pass,
    label: (b) => b,
    rank: (b) => (PASSES as readonly string[]).indexOf(b),
    sortValue: (r) => (PASSES as readonly string[]).indexOf(r.pass),
    sortLabels: ["Process order", "Reverse order"],
  },
  text("project", "Project", "Unassigned"),
  text("client", "Client", "No client"),
  text("person", "Who"),
  text("model", "Model"),
  {
    key: "tokens",
    name: "Tokens",
    bucket: (r) => band(r.tokens, TOKEN_BANDS),
    label: (b) => (b === NONE ? "Not recorded" : b),
    rank: bandRank(TOKEN_BANDS),
    sortValue: (r) => r.tokens,
    sortLabels: ["Fewest first", "Most first"],
  },
  {
    key: "cost",
    name: "Cost",
    bucket: (r) => band(r.cost, COST_BANDS),
    label: (b) => (b === NONE ? "Not recorded" : b),
    rank: bandRank(COST_BANDS),
    sortValue: (r) => r.cost,
    sortLabels: ["Cheapest first", "Dearest first"],
  },
  {
    key: "outcome",
    name: "Outcome",
    bucket: (r) => r.status,
    label: (b) => OUTCOME[b as RunRow["status"]] ?? b,
    rank: (b) => ["failed", "running", "done"].indexOf(b),
    sortValue: (r) => ["failed", "running", "done"].indexOf(r.status),
    sortLabels: ["Failures first", "Done first"],
  },
];
const WIDTH = 9;

/** Every run in the range, on the shared table engine: sort, group and
 *  filter from the headers (remembered in this browser), search, and each
 *  group's total cost in its heading. Newest first until sorted otherwise. */
export function RunsTable({ runs }: { runs: RunRow[] }) {
  const [view, change] = useSavedView("usage-runs-view");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ sections: Column<RunRow>[]; anchor: DOMRect } | null>(null);
  const live = sanitize(view, COLUMNS);
  const needle = q.trim().toLowerCase();
  const searched = needle
    ? runs.filter((r) => [r.subject, r.project, r.client, r.person, r.pass, r.model].some((x) => x?.toLowerCase().includes(needle)))
    : runs;
  const groups = applyView(searched, COLUMNS, live.sort ? live : { ...live, sort: { key: "when", dir: "desc" } });
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const col = (key: string) => COLUMNS.find((c) => c.key === key)!;
  const header = (label: string, key: string) => (
    <HeaderButton text={label} sections={[col(key)]} view={live} onOpen={(sections, anchor) => setMenu({ sections, anchor })} />
  );
  const total = (rows: RunRow[]) => rows.reduce((s, r) => s + (r.cost ?? 0), 0);

  const row = (r: RunRow) => (
    <tr key={r.id}>
      <td className="num" style={{ textAlign: "left" }}>
        {r.when}
      </td>
      <td>
        {r.pass}
        {r.subject && (
          <div className="meta" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.subject}>
            {r.subject}
          </div>
        )}
      </td>
      <td>{r.project}</td>
      <td className="meta" style={{ fontSize: 12.5 }}>
        {r.client ?? "—"}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>{r.person}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        {r.model}
        {r.answeredBy && <div className="meta">answered by {r.answeredBy}</div>}
      </td>
      <td className="num">{r.tokens === null ? "—" : compact(r.tokens)}</td>
      <td className="num">{r.cost === null ? "—" : money(r.cost)}</td>
      <td>
        <Outcome run={r} />
      </td>
    </tr>
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", minHeight: 28 }}>
        <input
          className="input"
          placeholder="Search interviews, projects, people"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 300, fontSize: 12.5 }}
        />
        <ViewChips columns={COLUMNS} view={live} onChange={change} />
        <span className="meta" style={{ marginLeft: "auto", fontSize: 12 }}>
          {shown} of {runs.length} runs · {money(groups.reduce((s, g) => s + total(g.rows), 0))}
        </span>
      </div>
      <div className="panel" style={{ overflow: "auto" }}>
        <table className="table table-compact">
          <thead>
            <tr>
              {header("When", "when")}
              {header("Pass", "pass")}
              {header("Project", "project")}
              {header("Client", "client")}
              {header("Who", "person")}
              {header("Model", "model")}
              {header("Tokens", "tokens")}
              {header("Cost", "cost")}
              {header("Outcome", "outcome")}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.bucket === null ? (
                g.rows.map(row)
              ) : (
                <GroupRows
                  key={g.bucket}
                  label={g.label}
                  count={g.rows.length}
                  width={WIDTH}
                  selectable={false}
                  allOn={false}
                  onSelect={() => {}}
                  extra={
                    <span className="mono meta" style={{ fontSize: 11.5 }}>
                      {" "}
                      · {money(total(g.rows))}
                    </span>
                  }
                >
                  {g.rows.map(row)}
                </GroupRows>
              ),
            )}
            {!shown && (
              <tr>
                <td colSpan={WIDTH} className="meta">
                  {runs.length ? "No runs match." : "No runs in this range."}{" "}
                  {runs.length > 0 && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        setQ("");
                        change(EMPTY_VIEW);
                      }}
                    >
                      Reset view
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {menu && <ColumnMenu columns={COLUMNS} sections={menu.sections} rows={searched} view={live} anchor={menu.anchor} onChange={change} onClose={() => setMenu(null)} />}
    </section>
  );
}

/** A run's state, in words with a mark: never colour alone. */
export function Outcome({ run }: { run: RunRow }) {
  if (run.status === "failed")
    return (
      <span className="tag" title={run.error ?? undefined} style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
        ✕ Failed
      </span>
    );
  if (run.status === "running") return <span className="tag tag-neutral">… Running</span>;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      ✓ {run.kept} kept{run.review ? <span className="meta"> · {run.review} to review</span> : null}
    </span>
  );
}
