"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { compact, money, PASSES } from "@/lib/usage";
import { Outcome, type RunRow } from "./RunsTable";

/** Which runs the drawer is about: every key given must match. */
export type UsageSelection = {
  kicker: string;
  title: string;
  match: Partial<Pick<RunRow, "projectId" | "clientId" | "personId" | "pass" | "bucket">>;
  /** Narrow the whole page to this, and the same in the Runs view (when the
   *  page can narrow that way). */
  pageHref?: string;
  runsHref?: string;
};

type Ctx = { open: (s: UsageSelection) => void; selected: UsageSelection | null };
const UsageDrawerContext = createContext<Ctx>({ open: () => {}, selected: null });

/** Anything on the dashboard that opens the drawer marks itself with this,
 *  so a click on another one switches the drawer instead of closing it. */
export const OPENS_DRAWER = { "data-usage-open": "" } as const;

export function useUsageDrawer() {
  return useContext(UsageDrawerContext);
}

/** Holds the runs behind the dashboard and the drawer that shows a slice of
 *  them — a client, project, person, pass, a day or week, or one project's
 *  pass — the way People and Organizations open theirs. Escape or a click
 *  elsewhere closes it. */
export function UsageDrawerProvider({ runs, runsHref, children }: { runs: RunRow[]; runsHref: string; children: React.ReactNode }) {
  const [selected, setSelected] = useState<UsageSelection | null>(null);

  useEffect(() => {
    if (!selected) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    const outside = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("aside[role=dialog], [data-usage-open]")) return;
      setSelected(null);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("click", outside);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("click", outside);
    };
  }, [selected]);

  return (
    <UsageDrawerContext.Provider value={{ open: setSelected, selected }}>
      {children}
      {selected && <UsageDrawer selection={selected} runs={runs} runsHref={runsHref} onClose={() => setSelected(null)} />}
    </UsageDrawerContext.Provider>
  );
}

const sameAs = (s: UsageSelection | null, t: UsageSelection) => !!s && JSON.stringify(s.match) === JSON.stringify(t.match);
/** For a trigger: is the drawer open on it? */
export function useIsOpen(t: UsageSelection) {
  return sameAs(useUsageDrawer().selected, t);
}

function UsageDrawer({ selection, runs, runsHref, onClose }: { selection: UsageSelection; runs: RunRow[]; runsHref: string; onClose: () => void }) {
  const mine = runs.filter((r) => Object.entries(selection.match).every(([k, v]) => r[k as keyof RunRow] === v));
  const spend = mine.reduce((s, r) => s + (r.cost ?? 0), 0);
  const failed = mine.filter((r) => r.status === "failed").length;
  const people = new Set(mine.map((r) => r.personId)).size;

  // Split it the ways it isn't already narrowed.
  const splits: [string, (r: RunRow) => string][] = [];
  if (!selection.match.pass) splits.push(["By pass", (r) => r.pass]);
  if (!selection.match.projectId) splits.push(["By project", (r) => r.project]);
  if (!selection.match.personId) splits.push(["By person", (r) => r.person]);

  const byPass = PASSES.map((p) => [p, mine.filter((r) => r.pass === p)] as const).filter(([, rs]) => rs.length);

  return (
    <Drawer
      kicker={selection.kicker}
      title={selection.title}
      summary={`${money(spend)} · ${mine.length} run${mine.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""} · ${people} ${people === 1 ? "person" : "people"}`}
      onClose={onClose}
    >
      {selection.pageHref && (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Link href={selection.pageHref} className="btn btn-secondary" style={{ fontSize: 12 }}>
            Narrow the page to this
          </Link>
          {selection.runsHref && (
            <Link href={selection.runsHref} className="btn btn-ghost" style={{ fontSize: 12 }}>
              Open in Runs
            </Link>
          )}
        </div>
      )}
      {!mine.length && <p className="meta">No runs.</p>}

      {splits.map(([title, keyOf]) => {
        const m = new Map<string, { runs: number; spend: number; tokens: number }>();
        for (const r of mine) {
          const k = keyOf(r);
          const e = m.get(k) ?? { runs: 0, spend: 0, tokens: 0 };
          e.runs += 1;
          e.spend += r.cost ?? 0;
          e.tokens += r.tokens ?? 0;
          m.set(k, e);
        }
        const rows = [...m.entries()].sort((a, b) => b[1].spend - a[1].spend);
        if (rows.length < 2 && title !== "By pass") return null;
        return (
          <section key={title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="kicker">{title}</span>
            <table className="table table-compact">
              <tbody>
                {rows.map(([k, e]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num meta">
                      {e.runs} run{e.runs === 1 ? "" : "s"}
                    </td>
                    <td className="num meta">{compact(e.tokens)} tokens</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {money(e.spend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {byPass.map(([pass, rs]) => (
        <section key={pass} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="kicker">
            {pass} runs <span className="meta mono" style={{ letterSpacing: 0 }}>· {rs.length} · {money(rs.reduce((s, r) => s + (r.cost ?? 0), 0))}</span>
          </span>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {rs.slice(0, 50).map((r) => (
              <li key={r.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line-1)", display: "grid", gridTemplateColumns: "1fr auto", gap: "2px var(--space-3)", fontSize: 12.5 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.subject ?? undefined}>
                  {r.subject ?? (selection.match.projectId ? r.pass : r.project)}
                </span>
                <span className="mono" style={{ textAlign: "right" }}>
                  {r.cost === null ? "—" : money(r.cost)}
                </span>
                <span className="meta" style={{ fontSize: 11.5 }}>
                  {r.when} · {r.person}
                  {!selection.match.projectId && r.subject ? ` · ${r.project}` : ""}
                </span>
                <span style={{ textAlign: "right", fontSize: 11.5 }}>
                  <Outcome run={r} />
                </span>
              </li>
            ))}
          </ol>
          {rs.length > 50 && (
            <Link href={selection.runsHref ?? runsHref} className="meta" style={{ fontSize: 12 }}>
              {rs.length - 50} more in Runs →
            </Link>
          )}
        </section>
      ))}
    </Drawer>
  );
}
