"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { LINE, ThemeName, ThemeRef, TipBody, expandTheme, muted, selectedRow, useExpanded, useTip } from "./bits";
import { KEEP, useCorpus } from "./CorpusContext";
import { projectHref } from "@/lib/urls";
import { withBase } from "@/lib/basePath";

export type MatrixBand = { name: string; span: number; labelled: boolean };
export type MatrixColumn = { id: string; key: string; title: string; participant: string | null; organization: string | null; codes: number };
export type MatrixRow = {
  id: string;
  ref: string;
  title: string;
  description: string | null;
  proposed: boolean;
  counts: number[]; // aligned with the columns
  shares: { hit: number; size: number }[]; // aligned with the bands
  ivs: number;
  codes: number; // across every interview
  only: string | null; // the one group this theme's support sits inside
  groups: number; // labelled groups it reaches
};

export const cellFill = (n: number) =>
  n >= 3 ? "var(--color-accent-800)" : n === 2 ? "var(--color-accent-600)" : n === 1 ? "var(--color-accent-300)" : null;
/** One hue, light to dark, by the share of a group that raises a theme. */
const shareFill = (s: number) =>
  s <= 0 ? null : s >= 1 ? "var(--color-accent-800)" : s > 2 / 3 ? "var(--color-accent-600)" : s > 1 / 3 ? "var(--color-accent-400)" : "var(--color-accent-200)";

const CELL = 26;
const SHARE_CELL = 58;
const SEP = 17; // the gap between groups, with a rule down its middle
const BAND_TONES = ["var(--color-accent-300)", "var(--color-navy-muted)"];

type Mode = "interviews" | "share";
type Slot = { kind: "cell"; i: number } | { kind: "sep" };

/** Theme × interview, or theme × group by share. Columns are grouped into
 *  bands when a facet is on; a row's name expands in place on click, growing
 *  only that row; a cell opens the quotes behind it. */
export function ThemeMatrix({
  projectPath,
  facetName,
  bands,
  columns,
  rows,
  loose,
  withProposed,
}: {
  projectPath: string;
  facetName: string | null;
  bands: MatrixBand[];
  columns: MatrixColumn[];
  rows: MatrixRow[];
  loose: number[];
  withProposed: boolean;
}) {
  const { open, toggle, all: allOpen, toggleAll } = useExpanded(rows.map((r) => r.id));
  const [mode, setMode] = useState<Mode>("interviews");
  const { openPanel, isSelected, select, toggleSelect } = useCorpus();
  const tip = useTip();
  /** Hover handlers that explain whatever the pointer is on. */
  const hint = (heading: React.ReactNode, lines: React.ReactNode[]) => ({
    onMouseMove: (e: React.MouseEvent) => tip.show(e, <TipBody heading={heading} lines={lines} />),
    onMouseLeave: tip.hide,
  });

  const grouped = !!facetName;
  const labelled = bands.filter((b) => b.labelled).length;
  const share = grouped && mode === "share";
  // A group's colour, matching its bar in the header.
  const toneOf = (name: string) => {
    const bi = bands.findIndex((b) => b.name === name);
    return bi < 0 || !bands[bi].labelled ? "var(--color-neutral-200)" : BAND_TONES[bi % 2];
  };
  // Where each band's interviews start among the columns.
  const starts = bands.map((_, bi) => bands.slice(0, bi).reduce((a, b) => a + b.span, 0));
  const bandOf = (col: number) => bands[starts.findLastIndex((s) => s <= col)];
  const groupLine = (col: number) => (grouped ? `${facetName}: ${bandOf(col)?.name}` : null);
  const total = columns.length;

  // By interview: cells in band order, with a ruled gap between bands. By
  // share: one cell per band.
  const slots: Slot[] = [];
  let at = 0;
  bands.forEach((b, bi) => {
    if (bi) slots.push({ kind: "sep" });
    if (share) slots.push({ kind: "cell", i: bi });
    else for (let k = 0; k < b.span; k++) slots.push({ kind: "cell", i: at++ });
  });
  const width = share ? SHARE_CELL : CELL;
  const template = ["64px", "minmax(220px, 340px)", ...slots.map((s) => `${s.kind === "cell" ? width : SEP}px`), "44px", "48px", ...(grouped ? ["190px"] : [])].join(" ");
  const row = { display: "grid", gridTemplateColumns: template, columnGap: 3, alignItems: "start" } as const;
  // Band names are set at an angle, so the header is as tall as the longest.
  const longest = Math.max(0, ...bands.map((b) => b.name.length));
  const bandHeight = Math.min(160, Math.round(longest * 6.3 * 0.72) + 26);

  const cells = (value: (i: number) => React.ReactNode) =>
    slots.map((s, k) =>
      s.kind === "sep" ? (
        <span
          key={`s${k}`}
          aria-hidden
          style={{ alignSelf: "stretch", margin: "-3px 0", background: "linear-gradient(var(--line-4), var(--line-4)) center / 1px 100% no-repeat" }}
        />
      ) : (
        <Fragment key={share ? bands[s.i].name : columns[s.i].id}>{value(s.i)}</Fragment>
      ),
    );

  const cellButton = (help: ReturnType<typeof hint>, fill: string | null, onOpen: (() => void) | null, label?: React.ReactNode, dark?: boolean) => (
    <button
      {...help}
      onClick={(e) => {
        // A filled cell opens its quotes and doesn't also toggle its row; an
        // empty one lets the click through, so the whole row selects.
        if (!onOpen) return;
        e.stopPropagation();
        onOpen();
      }}
      tabIndex={onOpen ? 0 : -1}
      aria-disabled={!onOpen}
      style={{
        all: "unset",
        boxSizing: "border-box",
        height: 17,
        marginTop: (LINE - 17) / 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: onOpen ? "pointer" : "default",
        background: fill ?? "transparent",
        border: `1px solid ${fill ?? muted(9)}`,
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 9.5,
        color: dark ? "#FFFFFF" : "var(--color-navy)",
      }}
    >
      {label}
    </button>
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 19, margin: 0 }}>{share ? "Theme × group" : "Theme × interview"}</h3>
        <span className="meta" style={{ fontSize: 12, flex: 1, minWidth: 280 }}>
          {share
            ? `Each cell is the share of that ${facetName!.toLowerCase()}'s interviews raising the theme, so a small group counts as much as a large one.`
            : "Cell weight = the interview's codes in that theme."}
          {grouped &&
            !share &&
            ` Columns are grouped by ${facetName.toLowerCase()}. A theme whose support sits inside one group is that group's view, not a finding.`}{" "}
          Click a row to select its theme in every chart, its name to read it in full, a cell for its quotes.
        </span>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          {grouped && (
            <div className="seg" role="radiogroup" aria-label="Columns">
              {(["interviews", "share"] as const).map((m) => (
                <label key={m} className="seg-opt">
                  <input type="radio" name="matrix-mode" checked={mode === m} onChange={() => setMode(m)} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
                  <span style={{ fontSize: 11.5 }}>{m === "interviews" ? "By interview" : "Share of group"}</span>
                </label>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={toggleAll}>
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
      </div>

      <div className="panel" style={{ padding: "var(--space-4)", overflowX: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", width: "max-content", minWidth: "100%" }}>
          {grouped && (
            <div style={{ ...row, alignItems: "end", height: bandHeight, marginBottom: 3 }}>
              <span />
              <span />
              {bands.map((b, bi) => (
                <Fragment key={b.name}>
                  {bi > 0 && <span />}
                  <div
                    {...hint(b.name, [
                      `${b.span} interview${b.span === 1 ? "" : "s"} (${Math.round((b.span / total) * 100)}% of the ${total})`,
                      b.labelled ? `${facetName} = ${b.name}` : `No ${facetName!.toLowerCase()} set on ${b.span === 1 ? "this interview" : "these interviews"} yet`,
                    ])}
                    style={{ gridColumn: `span ${share ? 1 : b.span}`, position: "relative", height: "100%" }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: `calc(50% - 5px)`,
                        bottom: 12,
                        transform: "rotate(-45deg)",
                        transformOrigin: "left bottom",
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        fontWeight: 600,
                        color: b.labelled ? "var(--color-navy)" : muted(50),
                        fontStyle: b.labelled ? undefined : "italic",
                      }}
                    >
                      {b.name}
                      <span className="mono" style={{ fontSize: 9.5, fontWeight: 400, color: muted(50), marginLeft: 5 }}>
                        {b.span}
                      </span>
                    </span>
                    <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 5, background: toneOf(b.name) }} />
                  </div>
                </Fragment>
              ))}
              <span />
              <span />
            </div>
          )}

          <div style={{ ...row, alignItems: "end", paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--color-divider)" }}>
            <span className="kicker" style={{ fontSize: 9.5 }}>
              Theme
            </span>
            <span />
            {cells((i) =>
              share ? (
                <span
                  className="mono"
                  {...hint(bands[i].name, [`Each cell in this column is out of the ${bands[i].span} ${bands[i].name} interview${bands[i].span === 1 ? "" : "s"}`])}
                  style={{ fontSize: 9, textAlign: "center", color: muted(55) }}
                >
                  of {bands[i].span}
                </span>
              ) : (
                <Link
                  href={withBase(`/transcripts/${columns[i].id}`)}
                  {...hint(`${columns[i].key} · ${columns[i].participant ?? columns[i].title}`, [
                    columns[i].participant ? columns[i].title : null,
                    columns[i].organization,
                    groupLine(i),
                    `${columns[i].codes} codes in total · ${loose[i] ?? 0} in no theme`,
                    "Click to open the transcript",
                  ])}
                  className="mono"
                  style={{ fontSize: 9, textAlign: "center", color: muted(55), textDecoration: "none" }}
                >
                  {columns[i].key}
                </Link>
              ),
            )}
            <span className="kicker" {...hint("Interviews", [`How many of the ${total} coded interviews hold at least one of the theme's codes`])} style={{ fontSize: 9.5, textAlign: "right" }}>
              Ivs
            </span>
            <span className="kicker" {...hint("Codes", ["The theme's codes, across every interview"])} style={{ fontSize: 9.5, textAlign: "right" }}>
              Codes
            </span>
            {grouped && (
              <span
                className="kicker"
                {...hint("Groups", [`How many ${facetName!.toLowerCase()} groups raise the theme, or the one group all its support comes from`])}
                style={{ fontSize: 9.5, paddingLeft: "var(--space-3)" }}
              >
                Groups
              </span>
            )}
          </div>

          {!rows.length && (
            <p className="meta" style={{ margin: "var(--space-2) 0" }}>
              {withProposed ? "No themes yet." : "No confirmed themes yet."} Propose or confirm them on the{" "}
              <Link href={projectHref(projectPath, "themes")}>Themes tab</Link>.
            </p>
          )}
          {rows.map((r) => {
            const expanded = open.has(r.id);
            return (
              <div
                key={r.id}
                {...KEEP}
                onClick={() => toggleSelect([r.id])}
                style={{
                  ...row,
                  cursor: "pointer",
                  padding: "3px 0",
                  borderRadius: 3,
                  ...(isSelected(r.id) ? selectedRow : { background: expanded ? "var(--color-accent-tint-soft)" : undefined }),
                }}
              >
                <ThemeRef text={r.ref} proposed={r.proposed} />
                <ThemeName
                  projectPath={projectPath}
                  title={r.title}
                  description={r.description}
                  proposed={r.proposed}
                  expanded={expanded}
                  onToggle={() => expandTheme(r.id, select, toggle)}
                />
                {cells((i) => {
                  if (share) {
                    const b = bands[i];
                    const { hit, size } = r.shares[i];
                    const s = size ? hit / size : 0;
                    const ids = columns.slice(starts[i], starts[i] + b.span).map((c) => c.id);
                    return cellButton(
                      hint(`${r.ref} · ${b.name}`, [
                        `${hit} of the ${size} ${b.name} interview${size === 1 ? "" : "s"} raise this theme (${Math.round(s * 100)}%)`,
                        hit ? "Click for their quotes" : null,
                      ]),
                      shareFill(s),
                      hit
                        ? () => {
                            select([r.id]);
                            openPanel({ kicker: `${r.ref} · ${b.name}`, title: r.title, parts: [{ themeId: r.id, transcriptIds: ids }] });
                          }
                        : null,
                      hit ? `${hit}/${size}` : null,
                      s > 2 / 3,
                    );
                  }
                  const n = r.counts[i];
                  const c = columns[i];
                  return cellButton(
                    hint(`${r.ref} · ${c.key}${c.participant ? ` · ${c.participant}` : ""}`, [
                      n
                        ? `${n} of this interview's codes ${n === 1 ? "is" : "are"} in ${r.ref} (${n} of the theme's ${r.codes})`
                        : `None of this interview's ${c.codes} codes are in ${r.ref}`,
                      groupLine(i),
                      n ? "Click for these quotes" : null,
                    ]),
                    cellFill(n),
                    n
                      ? () => {
                          select([r.id]);
                          openPanel({ kicker: `${r.ref} · ${c.key} · ${c.participant ?? c.title}`, title: r.title, parts: [{ themeId: r.id, transcriptIds: [c.id] }] });
                        }
                      : null,
                  );
                })}
                <span
                  className="mono"
                  {...hint(`${r.ivs} of ${total} interviews`, [
                    `${r.ivs} interview${r.ivs === 1 ? "" : "s"} hold at least one of ${r.ref}'s codes; ${total - r.ivs} don't`,
                  ])}
                  style={{ fontSize: 10, lineHeight: `${LINE}px`, textAlign: "right", color: muted(60) }}
                >
                  {r.ivs}/{total}
                </span>
                <span
                  className="mono"
                  {...hint(`${r.codes} code${r.codes === 1 ? "" : "s"}`, [
                    `${r.ref} holds ${r.codes} code${r.codes === 1 ? "" : "s"} across ${r.ivs} interview${r.ivs === 1 ? "" : "s"}`,
                    r.ivs ? `About ${(r.codes / r.ivs).toFixed(1)} per interview that raises it` : null,
                  ])}
                  style={{ fontSize: 10, lineHeight: `${LINE}px`, textAlign: "right", color: "var(--color-navy)" }}
                >
                  {r.codes}
                </span>
                {grouped && (
                  <span style={{ paddingLeft: "var(--space-3)", minWidth: 0, lineHeight: `${LINE}px`, display: "flex" }}>
                    {r.only ? (
                      <span
                        {...hint(`Only ${r.only}`, [`Every interview behind ${r.ref} is in ${r.only}`, "That's this group's view, not a finding across groups"])}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 11.5, color: "var(--color-navy)" }}
                      >
                        <span style={{ width: 10, height: 5, flex: "none", background: toneOf(r.only) }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Only {r.only}</span>
                      </span>
                    ) : (
                      <span
                        className="mono"
                        {...hint(`${r.groups} of ${labelled} groups`, [
                          `Raised in: ${bands.filter((b, i) => b.labelled && r.shares[i]?.hit).map((b) => b.name).join(", ") || "none"}`,
                          bands.some((b, i) => b.labelled && !r.shares[i]?.hit)
                            ? `Not raised in: ${bands.filter((b, i) => b.labelled && !r.shares[i]?.hit).map((b) => b.name).join(", ")}`
                            : null,
                        ])}
                        style={{ fontSize: 10, color: muted(r.groups ? 60 : 35) }}
                      >
                        {r.groups ? `${r.groups} of ${labelled} groups` : "—"}
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}

          {!share && (
            <div style={{ ...row, alignItems: "center", padding: "var(--space-2) 0 2px", marginTop: "var(--space-1)", borderTop: "1px solid var(--color-divider)" }}>
              <span />
              <span style={{ fontSize: 12, color: muted(60) }}>Codes in no theme</span>
              {cells((i) => (
                <span
                  className="mono"
                  {...hint(`${columns[i].key} · codes in no theme`, [
                    `${loose[i] || "None"} of this interview's ${columns[i].codes} codes ${loose[i] === 1 ? "isn't" : "aren't"} in any theme yet`,
                  ])}
                  style={{ fontSize: 10, textAlign: "center", color: muted(loose[i] ? 70 : 30) }}
                >
                  {loose[i] || "·"}
                </span>
              ))}
              <span />
              <span
                className="mono"
                {...hint("Codes in no theme", [`${loose.reduce((a, b) => a + b, 0)} codes across all ${total} interviews aren't in any theme yet`])}
                style={{ fontSize: 10, textAlign: "right", color: muted(60) }}
              >
                {loose.reduce((a, b) => a + b, 0)}
              </span>
              {grouped && <span />}
            </div>
          )}
        </div>
      </div>

      {tip.node}
      <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center", flexWrap: "wrap", fontSize: 11.5, color: muted(60) }}>
        {share
          ? (
              [
                [0.25, "up to a third"],
                [0.5, "up to two thirds"],
                [0.8, "more than two thirds"],
                [1, "all"],
              ] as const
            ).map(([s, text]) => (
              <span key={text} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 14, height: 12, background: shareFill(s)! }} />
                {text}
              </span>
            ))
          : [1, 2, 3].map((n) => (
              <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 14, height: 12, background: cellFill(n)! }} />
                {n === 3 ? "3+ codes" : `${n} code${n === 1 ? "" : "s"}`}
              </span>
            ))}
        {withProposed && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span className="mono" style={{ fontSize: 9.5, padding: "0 4px", border: "1px dashed var(--color-accent-400)", color: "var(--color-accent-700)" }}>
              TH
            </span>
            proposed
          </span>
        )}
        <span>Click a theme&apos;s name to read it in full.</span>
      </div>
    </section>
  );
}
