"use client";

import { money } from "@/lib/usage";
import { OPENS_DRAWER, useUsageDrawer, type UsageSelection } from "./UsageDrawer";

/** Where a click leads: the page narrowed to it, and the same in Runs. */
export type Hrefs = { page: string; runs: string };

export type CostRow = {
  /** The project's id, or "__none__" for runs on unassigned transcripts. */
  key: string;
  name: string;
  client: string | null;
  byPass: Record<string, number>;
  total: number;
  interviews: number | null;
  hrefs: Hrefs;
  /** The page narrowed to this project and one pass. */
  passHrefs: Record<string, Hrefs>;
};

/** What each project cost to build: spend by pass in column groups
 *  (Interviews, Artifacts, Altogether). A row opens the project's runs in
 *  the drawer; a figure opens that project's runs of that pass; a total
 *  opens that pass across every project. */
export function CostTable({
  rows,
  interviewPasses,
  artifactPasses,
  passTotals,
  passHrefs,
  spend,
}: {
  rows: CostRow[];
  interviewPasses: string[];
  artifactPasses: string[];
  passTotals: Record<string, number>;
  passHrefs: Record<string, Hrefs>;
  spend: number;
}) {
  const { open, selected } = useUsageDrawer();
  const passes = [...interviewPasses, ...artifactPasses];
  const startsGroup = (pass: string) => pass === interviewPasses[0] || pass === artifactPasses[0];
  const is = (s: UsageSelection) => !!selected && JSON.stringify(selected.match) === JSON.stringify(s.match);

  const forProject = (r: CostRow): UsageSelection => ({
    kicker: r.client ? `Project · ${r.client}` : "Project",
    title: r.name,
    match: { projectId: r.key },
    pageHref: r.hrefs.page,
    runsHref: r.hrefs.runs,
  });
  const forCell = (r: CostRow, pass: string): UsageSelection => ({
    kicker: `${pass} · ${r.client ?? "project"}`,
    title: r.name,
    match: { projectId: r.key, pass },
    pageHref: r.passHrefs[pass]?.page,
    runsHref: r.passHrefs[pass]?.runs,
  });
  const forPass = (pass: string): UsageSelection => ({
    kicker: "Pass, every project",
    title: pass,
    match: { pass },
    pageHref: passHrefs[pass]?.page,
    runsHref: passHrefs[pass]?.runs,
  });
  // A figure's own click shouldn't also open its row.
  const cell = (s: UsageSelection) => ({
    ...OPENS_DRAWER,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      open(s);
    },
    title: "Click for these runs",
  });

  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <table className="table table-compact">
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: "bottom" }}>
              Project
            </th>
            {interviewPasses.length > 0 && (
              <th colSpan={interviewPasses.length} className="group-name group-start">
                Interviews
              </th>
            )}
            {artifactPasses.length > 0 && (
              <th colSpan={artifactPasses.length} className="group-name group-start">
                Artifacts
              </th>
            )}
            <th colSpan={3} className="group-name group-start summary">
              Altogether
            </th>
          </tr>
          <tr>
            {passes.map((p) => (
              <th key={p} className={`num${startsGroup(p) ? " group-start" : ""}`}>
                {p}
              </th>
            ))}
            <th className="num group-start summary">Total</th>
            <th className="num summary">Interviews</th>
            <th className="num summary">Per interview</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const project = forProject(r);
            return (
              <tr key={r.key} {...OPENS_DRAWER} onClick={() => open(project)} className={is(project) ? "usage-open" : undefined} style={{ cursor: "pointer" }}>
                <td style={{ minWidth: 200 }}>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                  {r.client && <span className="meta"> · {r.client}</span>}
                </td>
                {passes.map((pass) => {
                  const s = forCell(r, pass);
                  const has = !!r.byPass[pass];
                  return (
                    <td
                      key={pass}
                      className={`num${startsGroup(pass) ? " group-start" : ""}${has ? " usage-cell" : ""}`}
                      {...(has ? cell(s) : {})}
                      style={is(s) ? { background: "var(--color-accent-tint)", fontWeight: 700 } : undefined}
                    >
                      {has ? money(r.byPass[pass]) : <span className="meta">·</span>}
                    </td>
                  );
                })}
                <td className="num group-start summary" style={{ fontWeight: 700 }}>
                  {money(r.total)}
                </td>
                <td className="num summary">{r.interviews ?? "·"}</td>
                <td className="num summary">{r.interviews ? money(r.total / r.interviews) : <span className="meta">·</span>}</td>
              </tr>
            );
          })}
          {rows.length > 1 && (
            <tr className="total">
              <td>All projects</td>
              {passes.map((pass) => {
                const s = forPass(pass);
                return (
                  <td
                    key={pass}
                    className={`num usage-cell${startsGroup(pass) ? " group-start" : ""}`}
                    {...cell(s)}
                    style={is(s) ? { background: "var(--color-accent-tint)" } : undefined}
                  >
                    {money(passTotals[pass])}
                  </td>
                );
              })}
              <td className="num group-start summary">{money(spend)}</td>
              <td className="summary" />
              <td className="summary" />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
