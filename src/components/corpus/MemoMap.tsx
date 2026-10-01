"use client";

import { useState } from "react";
import Link from "next/link";
import type { MemoFlag } from "@/lib/corpus/views";
import { TipBody, muted, selectedRow, useTip } from "./bits";
import { KEEP, useCorpus } from "./CorpusContext";
import { projectHref } from "@/lib/urls";

export type MemoPoint = {
  id: string;
  ref: string;
  title: string;
  proposed: boolean;
  ivs: number;
  groups: number; // labelled groups reached
  codes: number;
  paragraphs: number; // memo paragraphs citing it
  flag: MemoFlag;
};

const W = 620;
const H = 340;
const M = { l: 48, r: 14, t: 30, b: 44 };
const DOT = 7;
const GAP = DOT * 2 + 3; // between themes on the same spot

type Region = "strong" | "between" | "little";
const REGION: Record<Region, { label: string; hint: string }> = {
  strong: { label: "Strong", hint: "The memo should cite these" },
  between: { label: "In between", hint: "Neither strong nor resting on little" },
  little: { label: "Rests on little", hint: "A claim resting on these needs care" },
};

/** The memo read against the evidence. Each theme is a dot: further right
 *  the more interviews it rests on, higher the more groups it reaches (or,
 *  with no groups, the more codes). Filled when the memo cites it, hollow
 *  when it doesn't. A hollow dot in the strong corner is a finding the memo
 *  leaves out; a filled dot in the shaded edge is a claim resting on little. */
export function MemoMap({ points, total, labelled, memoNames }: { points: MemoPoint[]; total: number; labelled: number; memoNames: string[] }) {
  const { projectPath, selected, isSelected, toggleSelect } = useCorpus();
  const tip = useTip();
  const [hover, setHover] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);

  const grouped = labelled >= 2;
  const yMax = grouped ? labelled : Math.max(4, ...points.map((p) => p.codes));
  const xMax = Math.max(total, 4);
  // Half a step of headroom, so a dot at the top or right edge isn't clipped.
  const x = (v: number) => M.l + (v / (xMax + 0.5)) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / (yMax + (grouped ? 0.5 : yMax * 0.08))) * (H - M.t - M.b);
  const strongAt = Math.max(3, Math.ceil(total * 0.25));
  const yValue = (p: MemoPoint) => (grouped ? p.groups : p.codes);
  // The same rules as the memo check: strong, resting on little, or neither.
  const regionOf = (p: MemoPoint): Region =>
    p.ivs >= strongAt && (!grouped || p.groups >= 2) ? "strong" : p.ivs <= 2 || (grouped && p.groups <= 1) ? "little" : "between";
  const inRegion = (r: Region) => points.filter((p) => regionOf(p) === r);

  // Themes on the same spot sit side by side.
  const spots = new Map<string, MemoPoint[]>();
  for (const p of points) {
    const k = `${p.ivs}:${yValue(p)}`;
    (spots.get(k) ?? spots.set(k, []).get(k)!).push(p);
  }
  // Labels go above a dot, or below it for every other dot on a shared spot.
  const place = new Map<string, { cx: number; cy: number; below: boolean }>();
  for (const group of spots.values())
    group.forEach((p, i) => place.set(p.id, { cx: x(p.ivs) + (i - (group.length - 1) / 2) * GAP, cy: y(yValue(p)), below: i % 2 === 1 }));

  const xTicks = Array.from({ length: xMax + 1 }, (_, i) => i).filter((i) => xMax <= 12 || i % 2 === 0);
  const yTicks = grouped ? Array.from({ length: yMax + 1 }, (_, i) => i) : [0, Math.round(yMax / 2), yMax];

  const cited = points.filter((p) => p.paragraphs > 0).length;
  const missing = points.filter((p) => p.flag?.kind === "strong-uncited");
  const narrow = points.filter((p) => p.flag?.kind === "cited-narrow");

  if (!memoNames.length)
    return (
      <div className="card" style={{ gap: "var(--space-3)" }}>
        <span className="card-kicker">Memo check</span>
        <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
          No memo yet. Once there is one, this maps every theme by how much evidence it rests on and shows which ones the
          memo cites. <Link href={projectHref(projectPath, "memo")}>Open the Memo tab →</Link>
        </p>
      </div>
    );

  return (
    <div className="card" style={{ gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <span className="card-kicker" style={{ margin: 0 }}>
          Memo check
        </span>
        <span className="meta" style={{ fontSize: 11.5 }}>
          {memoNames.join(", ")} · cites {cited} of {points.length} themes
        </span>
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", fontSize: 12, color: muted(72) }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="5.5" fill="var(--color-accent-700)" />
          </svg>
          Cited in the memo
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="5" fill="var(--color-surface)" stroke="var(--color-accent-700)" strokeWidth="2" />
          </svg>
          Not cited
        </span>
        <span>
          <strong style={{ color: "var(--color-navy)" }}>{missing.length}</strong> strong, not cited ·{" "}
          <strong style={{ color: "var(--color-navy)" }}>{narrow.length}</strong> cited, resting on little
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 640px) minmax(220px, 1fr)", gap: "var(--space-6)", alignItems: "start" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Themes by interviews and groups, marked by whether the memo cites them">
          {/* The regions. Each lists its themes beside the chart when clicked. */}
          {(
            [
              ["strong", [[x(strongAt - 0.5), M.t, W - M.r - x(strongAt - 0.5), (grouped ? y(1.5) : H - M.b) - M.t]], "var(--color-accent-tint)"],
              ["between", strongAt > 3 ? [[x(2.5), M.t, x(strongAt - 0.5) - x(2.5), (grouped ? y(1.5) : H - M.b) - M.t]] : [], "var(--color-surface)"],
              [
                "little",
                [[M.l, M.t, x(2.5) - M.l, H - M.b - M.t], ...(grouped ? [[x(2.5), y(1.5), W - M.r - x(2.5), H - M.b - y(1.5)]] : [])],
                "var(--color-neutral-100)",
              ],
            ] as [Region, number[][], string][]
          ).map(([r, rects, fill]) =>
            rects.map(([rx, ry, rw, rh], i) => {
              const n = inRegion(r).length;
              return (
                <rect
                  key={`${r}${i}`}
                  {...KEEP}
                  x={rx}
                  y={ry}
                  width={Math.max(0, rw)}
                  height={Math.max(0, rh)}
                  fill={fill}
                  stroke={region === r ? "var(--color-accent-700)" : "none"}
                  strokeWidth={1.5}
                  style={{ cursor: "pointer", filter: region === r ? "brightness(0.97)" : undefined }}
                  onClick={() => setRegion((cur) => (cur === r ? null : r))}
                  onMouseMove={(e) =>
                    tip.show(
                      e,
                      <TipBody
                        heading={`${REGION[r].label} · ${n} theme${n === 1 ? "" : "s"}`}
                        lines={[REGION[r].hint, region === r ? "Click to go back to what needs a look" : "Click to list them beside the chart"]}
                      />,
                    )
                  }
                  onMouseLeave={tip.hide}
                />
              );
            }),
          )}
          {/* Region names sit above the plot, clear of the dots. */}
          <text x={x(strongAt - 0.5) + 2} y={M.t - 9} fontSize="10.5" fontWeight="700" letterSpacing="0.06em" fill="var(--color-accent-800)">
            STRONG →
          </text>
          <text x={M.l + 2} y={M.t - 9} fontSize="10.5" fontWeight="700" letterSpacing="0.06em" fill={muted(55)}>
            RESTS ON LITTLE
          </text>
          <line x1={x(strongAt - 0.5)} x2={x(strongAt - 0.5)} y1={M.t} y2={H - M.b} stroke="var(--color-accent-400)" strokeDasharray="4 3" />
          {grouped && <line x1={x(2.5)} x2={W - M.r} y1={y(1.5)} y2={y(1.5)} stroke={muted(22)} strokeDasharray="4 3" />}

          {/* Axes: recessive. */}
          <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke={muted(25)} />
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={H - M.b + 15} textAnchor="middle" fontSize="10" fill={muted(55)}>
              {t}
            </text>
          ))}
          <text x={(M.l + W - M.r) / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={muted(65)}>
            Interviews it rests on (of {total})
          </text>
          {yTicks.map((t) => (
            <text key={t} x={M.l - 10} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={muted(55)}>
              {t}
            </text>
          ))}
          <text transform={`translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill={muted(65)}>
            {grouped ? `Groups it reaches (of ${labelled})` : "Codes"}
          </text>

          {points.map((p) => {
            const at = place.get(p.id)!;
            const on = p.paragraphs > 0;
            const lit = hover === p.id;
            const picked = isSelected(p.id);
            return (
              <g
                key={p.id}
                role="button"
                tabIndex={0}
                aria-pressed={picked}
                aria-label={`${p.ref} ${p.title}`}
                opacity={((selected.length && !picked) || (region && regionOf(p) !== region)) && !lit ? 0.28 : 1}
                style={{ cursor: "pointer", outline: "none" }}
                onMouseMove={(e) => {
                  setHover(p.id);
                  tip.show(
                    e,
                    <TipBody
                      heading={`${p.ref} · ${p.title}`}
                      lines={[
                        `${p.ivs} of ${total} interviews${grouped ? ` · ${p.groups} of ${labelled} groups` : ""} · ${p.codes} codes`,
                        on ? `Cited in ${p.paragraphs} memo paragraph${p.paragraphs === 1 ? "" : "s"}` : "Not cited in the memo",
                        p.flag?.reason,
                        p.proposed ? "Proposed, not yet confirmed" : null,
                        picked ? "Selected · click to clear" : "Click to select it in every chart",
                      ]}
                    />,
                  );
                }}
                onMouseLeave={() => {
                  setHover(null);
                  tip.hide();
                }}
                onClick={() => toggleSelect([p.id])}
                onKeyDown={(e) => e.key === "Enter" && toggleSelect([p.id])}
              >
                {/* A larger hit target than the mark. */}
                <circle cx={at.cx} cy={at.cy} r={DOT + 5} fill="transparent" />
                {picked && <circle cx={at.cx} cy={at.cy} r={DOT + 5} fill="none" stroke="var(--color-accent-700)" strokeWidth={2} />}
                <circle
                  cx={at.cx}
                  cy={at.cy}
                  r={lit || picked ? DOT + 1.5 : DOT}
                  fill={on ? "var(--color-accent-700)" : "var(--color-surface)"}
                  stroke={on ? "var(--color-surface)" : "var(--color-accent-700)"}
                  strokeWidth={on ? 2 : 2.2}
                  strokeDasharray={p.proposed && !on ? "3 2" : undefined}
                />
                {(p.flag || lit || picked) && (
                  <text
                    x={at.cx}
                    y={at.below ? at.cy + DOT + 13 : at.cy - DOT - 5}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight={p.flag || picked ? 700 : 500}
                    fill="var(--color-navy)"
                    style={{ paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 3 }}
                  >
                    {p.ref}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <MemoList
          missing={missing}
          narrow={narrow}
          region={region ? { key: region, points: inRegion(region) } : null}
          onBack={() => setRegion(null)}
          hover={hover}
          setHover={setHover}
        />
      </div>
      {tip.node}
      <p className="meta" style={{ margin: 0, fontSize: 11.5 }}>
        Strong: at least a quarter of the interviews (never fewer than three){grouped ? " and more than one group" : ""}. Shaded
        grey: two interviews or fewer{grouped ? ", or one group" : ""}. Labelled dots need a look. Click a region to list its themes; click a dot to select that theme in every chart.
      </p>
    </div>
  );
}

/** Beside the chart: the themes that need a look, or, when a region is
 *  clicked, every theme in it. Hovering one picks out its dot. */
function MemoList({
  missing,
  narrow,
  region,
  onBack,
  hover,
  setHover,
}: {
  missing: MemoPoint[];
  narrow: MemoPoint[];
  region: { key: Region; points: MemoPoint[] } | null;
  onBack: () => void;
  hover: string | null;
  setHover: (id: string | null) => void;
}) {
  const { isSelected, toggleSelect } = useCorpus();
  const block = (title: string, rows: MemoPoint[]) =>
    rows.length > 0 && (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span className="kicker" style={{ fontSize: 9.5, marginBottom: 4 }}>
          {title}
        </span>
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => toggleSelect([r.id])}
            aria-pressed={isSelected(r.id)}
            onMouseEnter={() => setHover(r.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(r.id)}
            onBlur={() => setHover(null)}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "grid",
              gridTemplateColumns: "44px 1fr",
              gap: "var(--space-2)",
              padding: "6px",
              borderTop: `1px solid ${muted(7)}`,
              ...(isSelected(r.id) ? selectedRow : { background: hover === r.id ? "var(--color-accent-tint-soft)" : undefined }),
            }}
          >
            <span className="mono" style={{ fontSize: 10, color: "var(--color-accent-700)", lineHeight: "18px" }}>
              {r.ref}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
              <span style={{ fontSize: 11.5, color: muted(62) }}>
                {region
                  ? [r.paragraphs ? `Cited in ${r.paragraphs} paragraph${r.paragraphs === 1 ? "" : "s"}` : "Not cited", r.flag?.reason].filter(Boolean).join(" · ")
                  : r.flag?.reason}
              </span>
            </span>
          </button>
        ))}
      </div>
    );
  if (region)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ alignSelf: "flex-start", fontSize: 11.5, padding: "2px 8px" }}>
          ← Back to what needs a look
        </button>
        {region.points.length ? (
          block(`${REGION[region.key].label} · ${region.points.length} theme${region.points.length === 1 ? "" : "s"}`, region.points)
        ) : (
          <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
            No themes here.
          </p>
        )}
      </div>
    );
  if (!missing.length && !narrow.length)
    return (
      <p style={{ margin: 0, fontSize: 12.5, color: muted(72) }}>
        Nothing needs a look: the memo cites every strong theme, and each theme it cites rests on three or more interviews
        across groups.
      </p>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {block("Strong, not cited", missing)}
      {block("Cited, resting on little", narrow)}
    </div>
  );
}
