"use client";

import { useMemo, useState } from "react";
import { chordLayout } from "@/lib/corpus/views";
import { TipBody, muted, selectedRow, useTip } from "./bits";
import { KEEP, useCorpus } from "./CorpusContext";

export type ChordTheme = { id: string; ref: string; title: string; proposed: boolean; ivs: string[]; codes: number };

const SIZE = 460;
const C = SIZE / 2;
const R_OUT = 176;
const R_IN = 163;
const R_RIBBON = R_IN - 2;
const LIST = 6;

const pt = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;
const arcPath = (a0: number, a1: number) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(R_OUT, a0)} A${R_OUT},${R_OUT} 0 ${large} 1 ${pt(R_OUT, a1)} L${pt(R_IN, a1)} A${R_IN},${R_IN} 0 ${large} 0 ${pt(R_IN, a0)} Z`;
};
const ribbonPath = (s0: number, s1: number, t0: number, t1: number) => {
  const r = R_RIBBON;
  return `M${pt(r, s0)} A${r},${r} 0 ${s1 - s0 > Math.PI ? 1 : 0} 1 ${pt(r, s1)} Q0,0 ${pt(r, t0)} A${r},${r} 0 ${t1 - t0 > Math.PI ? 1 : 0} 1 ${pt(r, t1)} Q0,0 ${pt(r, s0)} Z`;
};

type Hover = { arc: number } | { ribbon: number } | null;

/** Themes that come up in the same interviews, as a chord diagram. Every
 *  theme sits on the circle; a ribbon joins two themes that share
 *  interviews, and each end is as wide as that theme's codes in the shared
 *  interviews. Hover to isolate; click a theme or ribbon to pin it, which
 *  selects it in every chart until it's clicked again or cleared. */
export function ThemeChord({ themes, matrix }: { themes: ChordTheme[]; matrix: number[][] }) {
  const { selected, toggleSelect } = useCorpus();
  const tip = useTip();
  const [hover, setHover] = useState<Hover>(null);
  const { arcs, ribbons } = useMemo(() => chordLayout(matrix), [matrix]);

  const shared = (i: number, j: number) => {
    const b = new Set(themes[j].ivs);
    return themes[i].ivs.filter((id) => b.has(id));
  };
  const pairs = ribbons
    .map((r, k) => {
      const i = r.source.index;
      const j = r.target.index;
      const together = shared(i, j).length;
      const either = new Set([...themes[i].ivs, ...themes[j].ivs]).size;
      return { k, i, j, together, either, codes: r.values };
    })
    .sort((a, b) => b.together - a.together || b.together / b.either - a.together / a.either);

  // The selection, as this chart's own terms: one theme is an arc, a pair
  // of themes is the ribbon between them. It stays lit when the pointer
  // leaves; a hover shows on top of it while it lasts.
  const indexOf = new Map(themes.map((t, i) => [t.id, i]));
  const pinned: Hover = (() => {
    if (selected.length === 1 && indexOf.has(selected[0])) return { arc: indexOf.get(selected[0])! };
    if (selected.length === 2) {
      const [a, b] = selected.map((id) => indexOf.get(id));
      const k = ribbons.findIndex((r) => (r.source.index === a && r.target.index === b) || (r.source.index === b && r.target.index === a));
      if (k >= 0) return { ribbon: k };
    }
    return null;
  })();
  const focus = hover ?? pinned;
  const litArc = (i: number) => !focus || ("arc" in focus ? focus.arc === i : ribbons[focus.ribbon].source.index === i || ribbons[focus.ribbon].target.index === i);
  const litRibbon = (k: number) => !focus || ("ribbon" in focus ? focus.ribbon === k : ribbons[k].source.index === focus.arc || ribbons[k].target.index === focus.arc);
  const isPinned = (h: Hover) => !!pinned && !!h && JSON.stringify(pinned) === JSON.stringify(h);

  const pinPair = (i: number, j: number) => toggleSelect([themes[i].id, themes[j].id]);
  const pairTip = (e: React.MouseEvent, p: (typeof pairs)[number]) =>
    tip.show(
      e,
      <TipBody
        heading={`${themes[p.i].ref} + ${themes[p.j].ref}`}
        lines={[
          `Together in ${p.together} of the ${p.either} interviews holding either`,
          `${p.codes[0]} of ${themes[p.i].ref}'s codes and ${p.codes[1]} of ${themes[p.j].ref}'s sit in those interviews`,
          isPinned({ ribbon: p.k }) ? "Pinned · click to unpin" : "Click to pin, and select both themes in every chart",
        ]}
      />,
    );

  if (themes.length < 2)
    return (
      <div className="card" style={{ gap: "var(--space-3)" }}>
        <span className="card-kicker">Themes that appear together</span>
        <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
          Needs two or more themes.
        </p>
      </div>
    );

  return (
    <div className="card" style={{ gap: "var(--space-3)" }}>
      <span className="card-kicker">Themes that appear together</span>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 420px) minmax(200px, 1fr)", gap: "var(--space-4)", alignItems: "center" }}>
        <svg viewBox={`${-C} ${-C} ${SIZE} ${SIZE}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Chord diagram of themes sharing interviews" onMouseLeave={() => { setHover(null); tip.hide(); }}>
          {ribbons.map((r, k) => {
            const p = pairs.find((x) => x.k === k)!;
            const on = litRibbon(k);
            const focused = !!focus && on;
            return (
              <path
                key={k}
                d={ribbonPath(r.source.start, r.source.end, r.target.start, r.target.end)}
                fill={focused ? "var(--color-accent-600)" : "var(--color-accent-400)"}
                fillOpacity={focus ? (on ? 0.8 : 0.06) : 0.45}
                stroke={isPinned({ ribbon: k }) ? "var(--color-accent-800)" : "var(--color-surface)"}
                strokeWidth={isPinned({ ribbon: k }) ? 1.5 : 0.8}
                style={{ cursor: "pointer" }}
                {...KEEP}
                onMouseMove={(e) => {
                  setHover({ ribbon: k });
                  pairTip(e, p);
                }}
                onClick={() => pinPair(p.i, p.j)}
              />
            );
          })}
          {arcs.map((a) => {
            const t = themes[a.index];
            const mid = (a.start + a.end) / 2;
            const right = Math.sin(mid) >= 0;
            const [lx, ly] = pt(R_OUT + 12, mid).split(",").map(Number);
            const on = litArc(a.index);
            return (
              <g
                key={t.id}
                {...KEEP}
                style={{ cursor: "pointer" }}
                opacity={on ? 1 : 0.35}
                onMouseMove={(e) => {
                  setHover({ arc: a.index });
                  const partners = ribbons.filter((r) => r.source.index === a.index || r.target.index === a.index).length;
                  tip.show(
                    e,
                    <TipBody
                      heading={`${t.ref} · ${t.title}`}
                      lines={[
                        `${t.ivs.length} interviews · ${t.codes} codes`,
                        partners ? `Shares interviews with ${partners} other theme${partners === 1 ? "" : "s"}` : "Shares no interview with another theme",
                        t.proposed ? "Proposed, not yet confirmed" : null,
                        isPinned({ arc: a.index }) ? "Pinned · click to unpin" : "Click to pin, and select it in every chart",
                      ]}
                    />,
                  );
                }}
                onClick={() => toggleSelect([t.id])}
              >
                <path
                  d={arcPath(a.start, a.end)}
                  fill={a.isolated ? "var(--color-neutral-200)" : t.proposed ? "var(--color-navy-muted)" : "var(--color-navy)"}
                  stroke={isPinned({ arc: a.index }) ? "var(--color-accent-600)" : t.proposed ? "var(--color-navy)" : "none"}
                  strokeWidth={isPinned({ arc: a.index }) ? 3 : 1}
                  strokeDasharray={t.proposed && !isPinned({ arc: a.index }) ? "3 2" : undefined}
                />
                <text x={lx} y={ly + 4} textAnchor={Math.abs(Math.sin(mid)) < 0.15 ? "middle" : right ? "start" : "end"} fontSize="12" fontWeight="600" fill="var(--color-navy)" fontFamily="ui-monospace, Menlo, monospace">
                  {t.ref}
                </text>
              </g>
            );
          })}
        </svg>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="kicker" style={{ fontSize: 9.5, marginBottom: 4 }}>
            Most shared
          </span>
          {!pairs.length && <span className="meta">No two themes share an interview yet.</span>}
          {pairs.slice(0, LIST).map((p) => (
            <button
              key={p.k}
              onMouseEnter={() => setHover({ ribbon: p.k })}
              onMouseMove={(e) => pairTip(e, p)}
              onMouseLeave={() => {
                setHover(null);
                tip.hide();
              }}
              onFocus={() => setHover({ ribbon: p.k })}
              onBlur={() => setHover(null)}
              onClick={() => pinPair(p.i, p.j)}
              style={{
                all: "unset",
                cursor: "pointer",
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) auto",
                gap: "var(--space-2)",
                alignItems: "center",
                padding: "6px 6px",
                borderTop: `1px solid ${muted(7)}`,
                ...(isPinned({ ribbon: p.k })
                  ? selectedRow
                  : { background: hover && "ribbon" in hover && hover.ribbon === p.k ? "var(--color-accent-tint-soft)" : undefined }),
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                {[p.i, p.j].map((i) => (
                  <span key={i} style={{ display: "flex", gap: 6, fontSize: 12, minWidth: 0 }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--color-accent-700)", flex: "none", lineHeight: "17px" }}>
                      {themes[i].ref}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{themes[i].title}</span>
                  </span>
                ))}
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: muted(65), whiteSpace: "nowrap" }}>
                {p.together} of {p.either}
              </span>
            </button>
          ))}
        </div>
      </div>
      {tip.node}
      <p className="meta" style={{ margin: 0, fontSize: 11.5 }}>
        Each ribbon joins two themes that share interviews; each end is as wide as that theme&apos;s codes in the shared
        interviews. &ldquo;4 of 6&rdquo;: both in 4 interviews, at least one in 6. Near-total overlap suggests one theme, not two.
        Hover to isolate; click a theme or ribbon to pin it.
      </p>
    </div>
  );
}
