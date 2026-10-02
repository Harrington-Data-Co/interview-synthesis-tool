import Link from "next/link";
import { Breakdown } from "@/components/usage/Breakdown";
import { SpendOverTime } from "@/components/usage/SpendOverTime";
import { createClient } from "@/lib/supabase/server";
import { compact, cost, costByProject, money, PASSES, RANGES, rangeFor, rangeStart, summarize, tokens, type UsageRun } from "@/lib/usage";
import { formatDateTime } from "@/lib/when";

type Query = { range?: string; client?: string; project?: string; person?: string; pass?: string };

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
 *  person or pass narrows the whole page to it. Owners only (the layout). */
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
    for (const [k, v] of Object.entries(next)) if (v && !(k === "range" && v === "30d")) q.set(k, v);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* Filters, in one row above everything they change. */}
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <nav aria-label="Range" className="seg">
          {RANGES.map(([k, label]) => (
            <Link
              key={k}
              href={href({ range: k })}
              className="seg-opt"
              aria-current={k === rangeKey ? "page" : undefined}
              style={{
                textDecoration: "none",
                ...(k === rangeKey ? { background: "var(--color-surface)", color: "var(--color-navy)", boxShadow: "var(--shadow-btn)", fontWeight: 700 } : {}),
              }}
            >
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

      {/* The headline: spend, then the counts around it. */}
      <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="meta">Spent, {rangeLabel.toLowerCase()}</span>
          <span style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.05, color: "var(--color-navy)" }}>{money(u.spend)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: "var(--space-3)", flex: 1, minWidth: 280 }}>
          <Tile label="Runs" value={compact(u.runs)} note={u.running ? `${u.running} running now` : null} />
          <Tile label="Failed" value={String(u.failed)} note={u.runs ? `${failedPct}% of runs` : null} />
          <Tile label="People running them" value={String(u.people)} />
          <Tile
            label="Per interview"
            value={u.perInterview.interviews ? money(u.perInterview.spend / u.perInterview.interviews) : "—"}
            note={u.perInterview.interviews ? `coding + notes, over ${u.perInterview.interviews} interview${u.perInterview.interviews === 1 ? "" : "s"}` : "no interviews coded"}
          />
          <Tile label="Tokens" value={compact(u.tokens)} note={u.runs ? `${money(u.spend / u.runs)} a run on average` : null} />
        </div>
      </div>
      {u.unpriced > 0 && (
        <p className="meta" style={{ margin: "calc(-1 * var(--space-3)) 0 0" }}>
          {u.unpriced} run{u.unpriced === 1 ? " has" : "s have"} no cost recorded (still running, failed before an answer, or answered by a model
          with no price on file), so the spend is a floor.
        </p>
      )}

      <section className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span className="kicker">Spend per {u.grain}</span>
        <SpendOverTime buckets={u.overTime} grain={u.grain} />
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "var(--space-4)" }}>
        <Breakdown title="By client" slices={u.byClient} hrefFor={(k) => href({ client: k })} />
        <Breakdown title="By project" slices={u.byProject} hrefFor={(k) => href({ project: k })} />
        <Breakdown title="By person" slices={u.byPerson} hrefFor={(k) => href({ person: k })} />
        <Breakdown title="By pass" slices={u.byPass} hrefFor={(k) => href({ pass: k })} />
      </div>

      {projectCosts.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="kicker">What each project cost to build</span>
          <p className="meta" style={{ margin: 0 }}>
            Spend {rangeKey === "all" ? "" : `(${rangeLabel.toLowerCase()}) `}by pass: coding and notes per interview, then each artifact.
            All-in per interview divides a project&apos;s spend by its interviews{rangeKey === "all" ? "" : "; choose All time for what a project cost overall"}.
          </p>
          <div className="panel" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  {shownPasses.map((p) => (
                    <th key={p} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {p}
                    </th>
                  ))}
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Interviews</th>
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>All-in per interview</th>
                </tr>
              </thead>
              <tbody>
                {projectCosts.map((row) => {
                  const p = row.projectId ? project.get(row.projectId) : null;
                  return (
                    <tr key={row.projectId ?? "none"}>
                      <td>
                        <Link href={href({ project: row.projectId ?? "__none__" })} style={{ color: "inherit" }}>
                          {names.project(row.projectId)}
                        </Link>
                        {p?.client && <div className="meta">{p.client}</div>}
                      </td>
                      {shownPasses.map((pass) => (
                        <td key={pass} className="mono" style={{ textAlign: "right" }}>
                          {row.byPass[pass] ? money(row.byPass[pass]) : <span className="meta">—</span>}
                        </td>
                      ))}
                      <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                        {money(row.total)}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {p ? p.interviews : "—"}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {p?.interviews ? money(row.total / p.interviews) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {projectCosts.length > 1 && (
                  <tr>
                    <td style={{ fontWeight: 700 }}>All projects</td>
                    {shownPasses.map((pass) => (
                      <td key={pass} className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                        {money(passTotals[pass])}
                      </td>
                    ))}
                    <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                      {money(u.spend)}
                    </td>
                    <td />
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="kicker">Runs{runs.length > 100 ? ` · latest 100 of ${runs.length}` : ""}</span>
        {!runs.length ? (
          <p className="meta">No runs {filters.length ? "match these filters" : "in this range"}.</p>
        ) : (
          <div className="panel" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Pass</th>
                  <th>Project</th>
                  <th>Who</th>
                  <th>Model</th>
                  <th style={{ textAlign: "right" }}>Tokens</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 100).map((r) => {
                  const p = r.project_id ? project.get(r.project_id) : null;
                  return (
                    <tr key={r.id}>
                      <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                        {formatDateTime(r.started_at)}
                      </td>
                      <td>
                        <div>{r.pass}</div>
                        {r.subject && (
                          <div className="meta" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.subject}>
                            {r.subject}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{names.project(r.project_id)}</div>
                        {p?.client && <div className="meta">{p.client}</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{names.person(r.started_by)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {modelName(r.model)}
                        {r.served_by && r.served_by !== r.model && <div className="meta">answered by {r.served_by.split(", ").map(modelName).join(", ")}</div>}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {r.input_tokens === null ? "—" : compact(tokens(r))}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {r.cost_usd === null ? "—" : money(cost(r))}
                      </td>
                      <td>
                        <Outcome run={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="card" style={{ gap: 2 }}>
      <span className="meta">{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700 }}>{value}</span>
      {note && <span className="meta" style={{ fontSize: 11.5 }}>{note}</span>}
    </div>
  );
}

/** A run's state, in words with a mark: never colour alone. */
function Outcome({ run }: { run: UsageRun }) {
  if (run.status === "failed")
    return (
      <span
        className="tag"
        title={run.error ?? undefined}
        style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}
      >
        ✕ Failed
      </span>
    );
  if (run.status === "running") return <span className="tag tag-neutral">… Running</span>;
  const kept = run.accepted ?? 0;
  const review = run.rejected ?? 0;
  return (
    <span style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
      ✓ {kept} kept{review ? <span className="meta"> · {review} to review</span> : null}
    </span>
  );
}
