import Link from "next/link";
import {
  bandCoverage,
  coverageNote,
  groupColumns,
  saturation,
  saturationNote,
  singleBand,
  compareRefs,
  themeRows,
  unthemed,
  type Facet,
  type MatrixCell,
} from "@/lib/corpus/derive";
import { chordMatrix, groupShares, memoFlag } from "@/lib/corpus/views";
import type { EvidenceCode, EvidenceInterview } from "@/lib/themes/evidence";
import { HoverTip } from "./bits";
import { CorpusProvider, type CorpusQuote } from "./CorpusContext";
import { EvidenceMixView } from "./EvidenceMixView";
import { MemoMap } from "./MemoMap";
import { ThemeChord } from "./ThemeChord";
import { ThemeMatrix } from "./ThemeMatrix";

export type CorpusTheme = {
  id: string;
  ref: string;
  title: string;
  description: string | null;
  proposed: boolean;
  codeIds: string[]; // its active codes
  memoParagraphs: number; // memo paragraphs citing it
};
/** A Facet as plain data, so it can cross from the loader to the view. */
export type FacetData = {
  id: string;
  name: string;
  values: string[];
  valueOf: Record<string, string>;
};

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** The whole-project view: when new interviews stop adding themes, how the
 *  interviews spread across groups, and which themes rest on many interviews
 *  rather than one person or one group. Themes are the rows because a code
 *  belongs to one transcript; the theme is what recurs. */
export function CorpusView({
  projectId,
  interviews,
  codes,
  themes,
  memoNames,
  cells,
  facets,
  facetId,
  withProposed,
  proposedCount,
  error,
}: {
  projectId: string;
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  themes: CorpusTheme[];
  memoNames: string[];
  cells: MatrixCell[];
  facets: FacetData[];
  facetId: string | undefined;
  withProposed: boolean;
  proposedCount: number;
  error: string | null;
}) {
  const href = (changes: { facet?: string; proposed?: boolean }) => {
    const q = new URLSearchParams({ view: "corpus" });
    const f = changes.facet ?? facetId;
    if (f) q.set("facet", f);
    if (changes.proposed ?? withProposed) q.set("proposed", "1");
    return `/projects/${projectId}?${q}`;
  };

  if (error)
    return (
      <div className="panel" style={{ padding: "var(--space-4)" }}>
        <p className="meta" style={{ margin: 0 }}>
          Could not read the corpus: {error}. If this mentions corpus_matrix, apply migration 20260929d_corpus.sql.
        </p>
      </div>
    );
  if (!interviews.length)
    return (
      <div className="panel" style={{ padding: "var(--space-4)" }}>
        <p className="meta" style={{ margin: 0 }}>
          No coded interviews yet. Code this project&apos;s interviews to see saturation and the theme × interview matrix.
        </p>
      </div>
    );

  const data = facets.find((f) => f.id === facetId) ?? facets[0] ?? null;
  const facet: Facet | null = data && {
    ...data,
    valueOf: new Map(Object.entries(data.valueOf)),
  };
  const ids = interviews.map((i) => i.id);
  const keyOf = new Map(interviews.map((i) => [i.id, i.key]));
  const ivOf = new Map(interviews.map((i) => [i.id, i]));
  const themeOf = new Map(themes.map((t) => [t.id, t]));

  // Every chart lists themes by number: TH-1, TH-2, … TH-10.
  const rows = themeRows(
    [...themes].sort((a, b) => compareRefs(a.ref, b.ref)).map((t) => t.id),
    cells,
  );
  const loose = unthemed(cells);
  const bars = saturation(ids, rows);
  const maxFresh = Math.max(1, ...bars.map((b) => b.fresh));
  const bands = groupColumns(ids, facet);
  const columns = bands.flatMap((b) => b.ids);
  const coverage = facet ? bandCoverage(bands, (id) => ivOf.get(id)?.codeCount ?? 0) : [];

  const totalCodes = interviews.reduce((a, i) => a + i.codeCount, 0);
  const looseTotal = [...loose.values()].reduce((a, b) => a + b, 0);
  const themed = totalCodes - looseTotal;
  // Each row: label, value, and what the value means on hover.
  const stats: [string, string, string][] = [
    ["Coded interviews", String(interviews.length), "Interviews in this project with at least one active code"],
    ["Codes", String(totalCodes), "Active codes across those interviews (a merged code counts once, as the code it was merged into)"],
    [
      withProposed ? "Themes (incl. proposed)" : "Confirmed themes",
      String(themes.length),
      withProposed ? "Every theme, confirmed or still proposed" : "Themes a person has confirmed; proposals are left out",
    ],
    [
      "Codes in a theme",
      totalCodes ? `${themed} · ${Math.round((themed / totalCodes) * 100)}%` : "—",
      `${themed} of the ${totalCodes} codes belong to at least one ${withProposed ? "" : "confirmed "}theme`,
    ],
    ["Codes in no theme", String(looseTotal), `${looseTotal} codes aren't in any ${withProposed ? "" : "confirmed "}theme yet: evidence the synthesis hasn't used`],
  ];

  // Each theme's quotes, in interview then line order, for the quotes panel
  // and the evidence mix.
  const codeOf = new Map(codes.map((c) => [c.id, c]));
  const order = new Map(ids.map((id, i) => [id, i]));
  const quotes: Record<string, CorpusQuote[]> = {};
  for (const t of themes)
    quotes[t.id] = t.codeIds
      .map((id) => codeOf.get(id))
      .filter((c): c is EvidenceCode => !!c)
      .map((c) => ({
        id: c.id,
        transcriptId: c.transcriptId,
        ref: c.ref,
        type: c.type,
        label: c.label,
        verbatim: c.verbatim,
        start: c.line_start,
        end: c.line_end,
      }))
      .sort((a, b) => (order.get(a.transcriptId) ?? 0) - (order.get(b.transcriptId) ?? 0) || a.start - b.start);
  const labelledCount = bands.filter((b) => b.labelled).length;
  const reached = (r: (typeof rows)[number]) => bands.filter((b) => b.labelled && b.ids.some((id) => r.counts.has(id))).length;

  const onStyle = {
    background: "var(--color-accent-tint)",
    color: "var(--color-accent-800)",
    fontWeight: 700,
  } as const;

  return (
    <CorpusProvider
      projectId={projectId}
      themes={themes.map((t) => ({
        id: t.id,
        ref: t.ref,
        title: t.title,
        description: t.description,
        proposed: t.proposed,
      }))}
      interviews={interviews.map((i) => ({
        id: i.id,
        key: i.key,
        title: i.title,
        participant: i.participant,
      }))}
      quotes={quotes}
    >
      {/* Room at the foot for the selection bar, so it never covers the last chart. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", paddingBottom: 72 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flexWrap: "wrap",
          }}
        >
          <p className="meta" style={{ margin: 0, maxWidth: "70ch" }}>
            Saturation says when to stop interviewing; the matrix says which themes are findings and which are one person&apos;s or one
            group&apos;s view.
          </p>
          <div className="seg" style={{ marginLeft: "auto" }}>
            <Link href={href({ proposed: false })} className="seg-opt" style={{ textDecoration: "none" }}>
              <span style={withProposed ? undefined : onStyle}>Confirmed themes</span>
            </Link>
            <Link href={href({ proposed: true })} className="seg-opt" style={{ textDecoration: "none" }}>
              <span style={withProposed ? onStyle : undefined}>With proposals{proposedCount ? ` (${proposedCount})` : ""}</span>
            </Link>
          </div>
        </div>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
            gap: "var(--space-6)",
            alignItems: "start",
          }}
        >
          <div className="card" style={{ gap: "var(--space-3)" }}>
            <span className="card-kicker">Saturation · new themes per interview</span>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 4,
                height: 110,
                marginTop: "var(--space-2)",
              }}
            >
              {bars.map((b) => (
                <HoverTip
                  key={b.id}
                  heading={`${keyOf.get(b.id)} · ${ivOf.get(b.id)?.participant ?? ivOf.get(b.id)?.title}`}
                  lines={[
                    ivOf.get(b.id)?.participant ? ivOf.get(b.id)?.title : null,
                    b.fresh ? `${b.fresh} theme${b.fresh === 1 ? "" : "s"} first appear${b.fresh === 1 ? "s" : ""} here` : "No theme appears here for the first time",
                    `${b.seen} of ${bars.at(-1)?.seen ?? 0} themes seen by this interview`,
                  ]}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    height: "100%",
                    justifyContent: "flex-end",
                  }}
                >
                  <span className="mono" style={{ fontSize: 9, color: muted(50) }}>
                    {b.fresh}
                  </span>
                  <div
                    style={{
                      width: "100%",
                      height: b.fresh ? Math.round((b.fresh / maxFresh) * 72) : 2,
                      background: b.fresh ? "var(--color-accent)" : muted(15),
                    }}
                  />
                  <span className="mono" style={{ fontSize: 8.5, color: muted(45) }}>
                    {keyOf.get(b.id)}
                  </span>
                </HoverTip>
              ))}
            </div>
            <p
              style={{
                margin: "var(--space-2) 0 0",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: muted(72),
              }}
            >
              {saturationNote(bars, (id) => keyOf.get(id) ?? "")}
            </p>
            <p className="meta" style={{ margin: 0, fontSize: 11.5 }}>
              In recording order. A theme is new in the first interview that holds one of its codes.
            </p>
          </div>

          <div className="card" style={{ gap: "var(--space-3)" }}>
            <span className="card-kicker">Corpus state</span>
            {stats.map(([k, v, what]) => (
              <HoverTip
                key={k}
                heading={`${k}: ${v}`}
                lines={[what]}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "var(--space-4)",
                  padding: "4px 0",
                  borderBottom: `1px solid ${muted(7)}`,
                  fontSize: 13,
                }}
              >
                <span>{k}</span>
                <span className="mono">{v}</span>
              </HoverTip>
            ))}
            <p
              style={{
                margin: "var(--space-2) 0 0",
                fontSize: 12,
                color: muted(58),
              }}
            >
              Codes in no theme are evidence the synthesis hasn&apos;t used yet. The row at the foot of the matrix shows where they sit.
            </p>
          </div>

          <div className="card" style={{ gap: "var(--space-3)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "var(--space-3)",
                flexWrap: "wrap",
              }}
            >
              <span className="card-kicker" style={{ margin: 0 }}>
                Coverage by group
              </span>
              {facets.length > 1 && (
                <div className="seg" style={{ marginLeft: "auto" }}>
                  {facets.map((f) => (
                    <Link key={f.id} href={href({ facet: f.id })} className="seg-opt" style={{ textDecoration: "none" }}>
                      <span style={f.id === facet?.id ? onStyle : undefined}>{f.name}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {coverage.map((c) => (
              <HoverTip
                key={c.name}
                heading={c.name}
                lines={[
                  `${c.ivs} of ${interviews.length} interviews (${Math.round(c.share * 100)}%) · ${c.codes} codes`,
                  c.name === "Unlabelled"
                    ? `No ${facet?.name.toLowerCase()} set on ${c.ivs === 1 ? "this interview" : "these interviews"} yet`
                    : c.thin
                      ? "Two interviews or fewer: a theme resting only here is a lead, not a finding"
                      : null,
                ]}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 96px",
                  gap: "var(--space-3)",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {c.name}
                </span>
                <div style={{ height: 14, background: muted(6) }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round(c.share * 100)}%`,
                      background: c.name === "Unlabelled" ? muted(25) : c.thin ? "var(--color-accent-300)" : "var(--color-accent)",
                    }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 10, textAlign: "right", color: muted(60) }}>
                  {c.ivs} ivs · {c.codes} codes
                </span>
              </HoverTip>
            ))}
            <p
              style={{
                margin: "var(--space-2) 0 0",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: muted(72),
              }}
            >
              {coverageNote(coverage, facet?.name ?? null)}
            </p>
          </div>
        </section>

        <ThemeMatrix
          projectId={projectId}
          facetName={facet?.name ?? null}
          bands={bands.map((b) => ({
            name: b.name,
            span: b.ids.length,
            labelled: b.labelled,
          }))}
          columns={columns.map((id) => {
            const iv = ivOf.get(id);
            return {
              id,
              key: keyOf.get(id) ?? "",
              title: iv?.title ?? "",
              participant: iv?.participant ?? null,
              organization: iv?.organization ?? null,
              codes: iv?.codeCount ?? 0,
            };
          })}
          rows={rows.map((r) => {
            const t = themeOf.get(r.themeId)!;
            return {
              id: r.themeId,
              ref: t.ref,
              title: t.title,
              description: t.description,
              proposed: t.proposed,
              counts: columns.map((id) => r.counts.get(id) ?? 0),
              ivs: r.ivs,
              codes: r.codes,
              only: singleBand(r, bands),
              groups: reached(r),
              shares: groupShares(r, bands).map(({ hit, size }) => ({
                hit,
                size,
              })),
            };
          })}
          loose={columns.map((id) => loose.get(id) ?? 0)}
          withProposed={withProposed}
        />

        <MemoMap
          total={interviews.length}
          labelled={labelledCount}
          memoNames={memoNames}
          points={rows.map((r) => {
            const t = themeOf.get(r.themeId)!;
            return {
              id: t.id,
              ref: t.ref,
              title: t.title,
              proposed: t.proposed,
              ivs: r.ivs,
              groups: reached(r),
              codes: r.codes,
              paragraphs: t.memoParagraphs,
              flag: memoFlag(r, bands, interviews.length, t.memoParagraphs > 0),
            };
          })}
        />

        <ThemeChord
          matrix={chordMatrix(rows)}
          themes={rows.map((r) => {
            const t = themeOf.get(r.themeId)!;
            return {
              id: t.id,
              ref: t.ref,
              title: t.title,
              proposed: t.proposed,
              ivs: [...r.counts.keys()],
              codes: r.codes,
            };
          })}
        />

        <EvidenceMixView
          themes={rows.map((r) => {
            const t = themeOf.get(r.themeId)!;
            return {
              id: t.id,
              ref: t.ref,
              title: t.title,
              description: t.description,
              proposed: t.proposed,
            };
          })}
        />
      </div>
    </CorpusProvider>
  );
}
