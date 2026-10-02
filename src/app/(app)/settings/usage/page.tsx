import Link from "next/link";
import { Breakdown } from "@/components/usage/Breakdown";
import { RunsTable, type RunRow } from "@/components/usage/RunsTable";
import { SpendOverTime } from "@/components/usage/SpendOverTime";
import { createClient } from "@/lib/supabase/server";
import { compact, cost, costByProject, dayOf, INTERVIEW_PASSES, money, PASSES, RANGES, rangeFor, rangeStart, summarize, tokens, type UsageRun } from "@/lib/usage";
import { formatDateTime } from "@/lib/when";

type Query = { view?: string; range?: string; client?: string; project?: string; person?: string; pass?: string };

const MODEL_NAMES: Record<string, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-fable-5-1": "Fable 5.1",
};
const modelName = (id: string | null) => (id ? (MODEL_NAMES[id] ?? id) : "—");

/** Settings → Usage: how the tool is being used and what it costs. Every
 *  Claude run (coding, notes, themes, memo, deck, process flows,
 *  architecture) in a range, as spend over time; spend by client, project,
 *  person and pass; what each project's artifacts cost to build and what an
 *  interview costs; and the runs themselves. Clicking a client, project,
 *  person or pass narrows the whole page to it. Two views: the dashboard,
 *  and every run in a table that sorts, groups and filters like the others.
 *  Owners only (the layout). */
export default async function UsagePage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const [rangeKey, rangeLabel, days] = rangeFor(query.range);
  const supabase = await createClient();
  const [{ data, error }, { data: seats }, { data: projects }, { data: clients }] = await Promise.all([
    supabase.rpc("usage_runs", { p_since: rangeStart(days) }),
    supabase.from("seat").select("user_id,name"),
    // Interviews per project, for the all-in cost of one.
    supabase.from("project").select("id,name,client_id,transcript(count)"),
    supabase.from("client").select("id,name"),
  ]);

  if (error) {
    return (
      <div className="panel" style={{ padding: "var(--space-4)" }}>
        <p className="meta" style={{ margin: 0 }}>
          Usage needs migration 20261001b_usage ({error.message}).
        </p>
      </div>
    );
  }

  const person = new Map((seats ?? []).map((s) => [s.user_id, s.name]));
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const project = new Map(
    (projects ?? []).map((p) => [
      p.id,
      {
        name: p.name,
        clientId: p.client_id as string,
        client: clientName.get(p.client_id) ?? null,
        interviews: ((p.transcript as unknown as { count: number }[] | null) ?? [])[0]?.count ?? 0,
      },
    ]),
  );
  const names = {
    project: (id: string | null) => (id ? (project.get(id)?.name ?? "A deleted project") : "Unassigned"),
    person: (id: string) => person.get(id) ?? "Someone",
    client: (id: string | null) => {
      const p = id ? project.get(id) : null;
      return p ? { id: p.clientId, name: p.client ?? "A client" } : null;
    },
  };

  const all = (data ?? []) as UsageRun[];
  const runs = all.filter(
    (r) =>
      (!query.client || (names.client(r.project_id)?.id ?? "__none__") === query.client) &&
      (!query.project || (r.project_id ?? "__none__") === query.project) &&
      (!query.person || r.started_by === query.person) &&
      (!query.pass || r.pass === query.pass),
  );
  const u = summarize(runs, names, { days });

  // Links keep the other choices.
  const href = (change: Partial<Query>) => {
    const next = { ...query, ...change };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v && !(k === "range" && v === "30d") && !(k === "view" && v === "dashboard")) q.set(k, v);
    const s = q.toString();
    return `/settings/usage${s ? `?${s}` : ""}`;
  };
  const filters: [keyof Query, string][] = [];
  if (query.client) filters.push(["client", query.client === "__none__" ? "No client" : (clientName.get(query.client) ?? "A client")]);
  if (query.project) filters.push(["project", query.project === "__none__" ? "Unassigned" : names.project(query.project)]);
  if (query.person) filters.push(["person", names.person(query.person)]);
  if (query.pass) filters.push(["pass", query.pass]);

  const failedPct = u.runs ? Math.round((u.failed / u.runs) * 100) : 0;
  const projectCosts = costByProject(runs);
  const passTotals = Object.fromEntries(PASSES.map((p) => [p, projectCosts.reduce((s, r) => s + (r.byPass[p] ?? 0), 0)]));
  const shownPasses = PASSES.filter((p) => passTotals[p] > 0);

  const runsView = query.view === "runs";
  const interviewPasses = shownPasses.filter((p) => INTERVIEW_PASSES.has(p));
  const artifactPasses = shownPasses.filter((p) => !INTERVIEW_PASSES.has(p));
  const rows: RunRow[] = runsView
    ? runs.map((r) => ({
        id: r.id,
        at: r.started_at,
        when: formatDateTime(r.started_at),
        day: dayOf(r.started_at),
        pass: r.pass,
        subject: r.subject,
        project: names.project(r.project_id),
        client: names.client(r.project_id)?.name ?? null,
        person: names.person(r.started_by),
        model: modelName(r.model),
        answeredBy: r.served_by && r.served_by !== r.model ? r.served_by.split(", ").map(modelName).join(", ") : null,
        tokens: r.input_tokens === null ? null : tokens(r),
        cost: r.cost_usd === null ? null : cost(r),
        status: r.status,
        kept: r.accepted ?? 0,
        review: r.rejected ?? 0,
        error: r.error,
      }))
    : [];

  const segStyle = (on: boolean) => ({
    textDecoration: "none",
    ...(on ? { background: "var(--color-surface)", color: "var(--color-navy)", boxShadow: "var(--shadow-btn)", fontWeight: 700 } : {}),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* The two views, then the range and filters both share. */}
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <nav aria-label="Usage view" className="seg">
          <Link href={href({ view: "dashboard" })} className="seg-opt" aria-current={!runsView ? "page" : undefined} style={segStyle(!runsView)}>
            Dashboard
          </Link>
          <Link href={href({ view: "runs" })} className="seg-opt" aria-current={runsView ? "page" : undefined} style={segStyle(runsView)}>
            Runs · {compact(runs.length)}
          </Link>
        </nav>
        <span aria-hidden style={{ width: 1, alignSelf: "stretch", background: "var(--line-3)" }} />
        <nav aria-label="Range" className="seg">
          {RANGES.map(([k, label]) => (
            <Link key={k} href={href({ range: k })} className="seg-opt" aria-current={k === rangeKey ? "page" : undefined} style={segStyle(k === rangeKey)}>
              {label}
            </Link>
          ))}
        </nav>
        {filters.map(([k, label]) => (
          <Link key={k} href={href({ [k]: undefined })} className="tag tag-outline" style={{ textDecoration: "none" }} title="Remove this filter">
            {label} ✕
          </Link>
        ))}
      </div>

      {runsView ? (
        <RunsTable runs={rows} />
      ) : (
        <>
          {/* The figures, all alike, in one strip. */}
          <div className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <Figure label={`Spent, ${rangeLabel.toLowerCase()}`} value={money(u.spend)} note={u.unpriced ? `${u.unpriced} run${u.unpriced === 1 ? "" : "s"} without a cost` : null} />
            <Figure label="Runs" value={compact(u.runs)} note={u.running ? `${u.running} running now` : u.runs ? `${money(u.spend / u.runs)} on average` : null} />
            <Figure label="Failed" value={String(u.failed)} note={u.runs ? `${failedPct}% of runs` : null} />
            <Figure label="People" value={String(u.people)} note="who ran something" />
            <Figure
              label="Per interview"
              value={u.perInterview.interviews ? money(u.perInterview.spend / u.perInterview.interviews) : "—"}
              note={u.perInterview.interviews ? `coding + notes · ${u.perInterview.interviews} interview${u.perInterview.interviews === 1 ? "" : "s"}` : "none coded"}
            />
            <Figure label="Tokens" value={compact(u.tokens)} note="in and out" />
          </div>
          {u.unpriced > 0 && (
            <p className="meta" style={{ margin: "calc(-1 * var(--space-4)) 0 0" }}>
              Runs without a cost were still running, failed before an answer, or were answered by a model with no price on file, so spend is a floor.
            </p>
          )}

          <section className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <span className="kicker">Spend per {u.grain}</span>
            <SpendOverTime buckets={u.overTime} grain={u.grain} />
          </section>

          {/* Two across at most, so four make a square. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(max(300px, calc(50% - var(--space-4))),1fr))", gap: "var(--space-4)" }}>
            <Breakdown title="By client" slices={u.byClient.map((x) => ({ ...x, href: href({ client: x.key }) }))} />
            <Breakdown title="By project" slices={u.byProject.map((x) => ({ ...x, href: href({ project: x.key }) }))} />
            <Breakdown title="By person" slices={u.byPerson.map((x) => ({ ...x, href: href({ person: x.key }) }))} />
            <Breakdown title="By pass" slices={u.byPass.map((x) => ({ ...x, href: href({ pass: x.key }) }))} />
          </div>

          {projectCosts.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span className="kicker">What each project cost to build</span>
              <p className="meta" style={{ margin: 0 }}>
                Spend{rangeKey === "all" ? "" : `, ${rangeLabel.toLowerCase()},`} by pass. All-in per interview divides a project&apos;s spend by its
                interviews{rangeKey === "all" ? "" : "; choose All time for what a project cost overall"}.
              </p>
              <div className="panel" style={{ overflowX: "auto" }}>
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th rowSpan={2} style={{ verticalAlign: "bottom" }}>
                        Project
                      </th>
                      {interviewPasses.length > 0 && (
                        <th colSpan={interviewPasses.length} className="num" style={{ textAlign: "center", borderBottom: "1px solid var(--line-2)" }}>
                          Interviews
                        </th>
                      )}
                      {artifactPasses.length > 0 && (
                        <th colSpan={artifactPasses.length} className="num" style={{ textAlign: "center", borderBottom: "1px solid var(--line-2)" }}>
                          Artifacts
                        </th>
                      )}
                      <th colSpan={3} className="num" style={{ textAlign: "center", borderBottom: "1px solid var(--line-2)" }}>
                        Altogether
                      </th>
                    </tr>
                    <tr>
                      {[...interviewPasses, ...artifactPasses].map((p) => (
                        <th key={p} className="num">
                          {p}
                        </th>
                      ))}
                      <th className="num">Total</th>
                      <th className="num">Interviews</th>
                      <th className="num">Per interview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectCosts.map((row) => {
                      const p = row.projectId ? project.get(row.projectId) : null;
                      return (
                        <tr key={row.projectId ?? "none"}>
                          <td style={{ minWidth: 200 }}>
                            <Link href={href({ project: row.projectId ?? "__none__" })} style={{ color: "inherit", fontWeight: 600 }}>
                              {names.project(row.projectId)}
                            </Link>
                            {p?.client && <span className="meta"> · {p.client}</span>}
                          </td>
                          {[...interviewPasses, ...artifactPasses].map((pass) => (
                            <td key={pass} className="num">
                              {row.byPass[pass] ? money(row.byPass[pass]) : <span className="meta">·</span>}
                            </td>
                          ))}
                          <td className="num" style={{ fontWeight: 700 }}>
                            {money(row.total)}
                          </td>
                          <td className="num">{p ? p.interviews : "·"}</td>
                          <td className="num">{p?.interviews ? money(row.total / p.interviews) : <span className="meta">·</span>}</td>
                        </tr>
                      );
                    })}
                    {projectCosts.length > 1 && (
                      <tr className="total">
                        <td>All projects</td>
                        {[...interviewPasses, ...artifactPasses].map((pass) => (
                          <td key={pass} className="num">
                            {money(passTotals[pass])}
                          </td>
                        ))}
                        <td className="num">{money(u.spend)}</td>
                        <td />
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** One figure in the strip: what it is, the number, and a line of context.
 *  Every figure is set the same way. */
function Figure({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div style={{ padding: "var(--space-3) var(--space-4)", display: "flex", flexDirection: "column", gap: 2, borderRight: "1px solid var(--line-1)", minWidth: 0 }}>
      <span className="meta">{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700, color: "var(--color-navy)", lineHeight: 1.2 }}>{value}</span>
      <span className="meta" style={{ fontSize: 11.5, minHeight: 15 }}>
        {note ?? ""}
      </span>
    </div>
  );
}
