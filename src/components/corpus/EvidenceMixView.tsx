"use client";

import { useState } from "react";
import { EVIDENCE_KINDS, evidenceMix, leaning, type EvidenceKind } from "@/lib/corpus/views";
import { muted as mutedColor } from "@/lib/palette";
import { LINE, ThemeName, ThemeRef, TipBody, expandTheme, muted, selectedRow, useExpanded, useTip } from "./bits";
import { KEEP, useCorpus } from "./CorpusContext";

export type MixTheme = { id: string; ref: string; title: string; description: string | null; proposed: boolean };

type Sort = "matrix" | EvidenceKind | "total";
type Scale = "count" | "share";

const LEAN: Record<EvidenceKind, string> = { problems: "Mostly problems", goals: "Mostly goals", today: "Mostly how it works today", other: "Mostly other" };

/** What each theme's evidence is made of: problems, goals, how work is done
 *  today, or other. Sorting by a kind moves its segment to the front of every
 *  bar and mutes the others. Show codes (how much evidence) or shares (what
 *  it's made of). Hover a segment for its detail; click it to select the
 *  theme and open those quotes. Counts sit beside each bar, so colour is
 *  never the only cue. */
export function EvidenceMixView({ themes }: { themes: MixTheme[] }) {
  const { projectPath, quotes, openPanel, selected, isSelected, select, toggleSelect } = useCorpus();
  const { open, toggle, all, toggleAll } = useExpanded(themes.map((t) => t.id));
  const [sort, setSort] = useState<Sort>("matrix");
  const [scale, setScale] = useState<Scale>("count");
  const tip = useTip();

  const rows = themes.map((t, order) => {
    const qs = quotes[t.id] ?? [];
    const mix = evidenceMix(qs.map((q) => q.type));
    const ivsOf = (types: readonly string[]) => new Set(qs.filter((q) => types.includes(q.type)).map((q) => q.transcriptId)).size;
    return { t, order, mix, ivsOf, ivs: new Set(qs.map((q) => q.transcriptId)).size };
  });
  const sorted = [...rows].sort((a, b) => {
    if (sort === "matrix") return a.order - b.order;
    if (sort === "total") return b.mix.total - a.mix.total || a.order - b.order;
    // By count, the most codes of that kind first; by share, the largest part
    // of the theme first. Ties go to the theme with more of it, then order.
    const share = (m: typeof a.mix) => (m.total ? m.kinds[sort] / m.total : 0);
    const first = scale === "share" ? share(b.mix) - share(a.mix) : b.mix.kinds[sort] - a.mix.kinds[sort];
    return first || b.mix.kinds[sort] - a.mix.kinds[sort] || b.mix.total - a.mix.total || a.order - b.order;
  });
  const most = Math.max(1, ...rows.map((r) => r.mix.total));
  // The sorted-by kind leads every bar in full colour; the rest follow in
  // their usual order, muted.
  const focusKind = sort === "matrix" || sort === "total" ? null : sort;
  const kindOrder = focusKind ? [...EVIDENCE_KINDS.filter((k) => k.key === focusKind), ...EVIDENCE_KINDS.filter((k) => k.key !== focusKind)] : [...EVIDENCE_KINDS];
  const colorOf = (k: (typeof EVIDENCE_KINDS)[number]) => (focusKind && k.key !== focusKind ? mutedColor(k.color) : k.color);

  const seg = <T extends string>(name: string, value: T, options: [T, string][], set: (v: T) => void) => (
    <div className="seg" role="radiogroup" aria-label={name}>
      {options.map(([v, text]) => (
        <label key={v} className="seg-opt">
          <input type="radio" name={`mix-${name}`} checked={value === v} onChange={() => set(v)} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
          <span style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5 }}>
            {EVIDENCE_KINDS.find((k) => k.key === v) && <span style={{ width: 10, height: 8, borderRadius: 2, background: EVIDENCE_KINDS.find((k) => k.key === v)!.color }} />}
            {text}
          </span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="card" style={{ gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <span className="card-kicker" style={{ margin: 0 }}>
          What each theme rests on
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", marginLeft: "auto" }}>
          <span className="kicker" style={{ fontSize: 9.5 }}>
            Sort
          </span>
          {seg<Sort>("sort", sort, [["matrix", "Theme order"], ...EVIDENCE_KINDS.map((k) => [k.key, k.label] as [Sort, string]), ["total", "Total"]], setSort)}
          {seg<Scale>("scale", scale, [["count", "Count"], ["share", "Share"]], setScale)}
          <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={toggleAll}>
            {all ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {!rows.length ? (
        <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
          No themes yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {sorted.map(({ t, mix, ivsOf, ivs }) => {
            const lean = leaning(mix);
            const shown = kindOrder.filter((k) => mix.kinds[k.key]);
            const expanded = open.has(t.id);
            const picked = isSelected(t.id);
            return (
              <div
                key={t.id}
                {...KEEP}
                onClick={() => toggleSelect([t.id])}
                style={{
                  cursor: "pointer",
                  display: "grid",
                  gridTemplateColumns: "56px minmax(200px, 340px) minmax(180px, 1fr) 190px",
                  columnGap: "var(--space-3)",
                  alignItems: "start",
                  padding: "4px 0",
                  borderTop: `1px solid ${muted(7)}`,
                  ...(picked ? selectedRow : { background: expanded ? "var(--color-accent-tint-soft)" : undefined }),
                }}
              >
                <ThemeRef text={t.ref} proposed={t.proposed} />
                <ThemeName projectPath={projectPath} title={t.title} description={t.description} proposed={t.proposed} expanded={expanded} onToggle={() => expandTheme(t.id, select, toggle)} />
                <div style={{ height: LINE, display: "flex", alignItems: "center", opacity: selected.length && !picked ? 0.35 : 1, transition: "opacity .15s" }}>
                  <div
                    style={{ display: "flex", gap: 2, height: 13, width: scale === "count" ? `${(mix.total / most) * 100}%` : "100%", minWidth: mix.total ? 6 : 0 }}
                    onMouseLeave={tip.hide}
                  >
                    {!mix.total && <span style={{ flex: 1, border: `1px dashed ${muted(15)}`, borderRadius: 3 }} />}
                    {shown.map((k, i) => {
                      const n = mix.kinds[k.key];
                      const byType = k.types.filter((ty) => mix.types[ty]).map((ty) => `${ty} ${mix.types[ty]}`);
                      const from = ivsOf(k.types);
                      const openIt = () => {
                        select([t.id]);
                        openPanel({ kicker: `${t.ref} · ${k.label}`, title: t.title, parts: [{ themeId: t.id, types: k.types }] });
                      };
                      return (
                        <button
                          key={k.key}
                          aria-label={`${k.label}: ${n} codes`}
                          onClick={(e) => {
                            // A segment opens its quotes; it doesn't also toggle its row.
                            e.stopPropagation();
                            openIt();
                          }}
                          onMouseMove={(e) =>
                            tip.show(
                              e,
                              <TipBody
                                heading={
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: k.color, boxShadow: "0 0 0 1px rgba(255,255,255,.6)" }} />
                                    {k.label} · {n} code{n === 1 ? "" : "s"}
                                  </span>
                                }
                                lines={[
                                  `${Math.round((n / mix.total) * 100)}% of ${t.ref}'s ${mix.total} codes`,
                                  byType.join(" · "),
                                  `From ${from} of the ${ivs} interview${ivs === 1 ? "" : "s"} behind ${t.ref}`,
                                  "Click for these quotes",
                                ]}
                              />,
                            )
                          }
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            flex: n,
                            background: colorOf(k),
                            transition: "background .15s",
                            borderRadius: `${i === 0 ? 3 : 0}px ${i === shown.length - 1 ? 3 : 0}px ${i === shown.length - 1 ? 3 : 0}px ${i === 0 ? 3 : 0}px`,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <span
                  onMouseMove={(e) => {
                    const k = EVIDENCE_KINDS.find((x) => x.key === sort);
                    tip.show(
                      e,
                      <TipBody
                        heading={`${t.ref} · ${mix.total} code${mix.total === 1 ? "" : "s"} from ${ivs} interview${ivs === 1 ? "" : "s"}`}
                        lines={
                          k
                            ? [
                                `${mix.kinds[k.key]} of the ${mix.total} are ${k.label.toLowerCase()} (${mix.total ? Math.round((mix.kinds[k.key] / mix.total) * 100) : 0}%)`,
                                k.types.filter((ty) => mix.types[ty]).map((ty) => `${ty} ${mix.types[ty]}`).join(" · ") || null,
                              ]
                            : [
                                ...EVIDENCE_KINDS.filter((x) => mix.kinds[x.key]).map(
                                  (x) => `${x.label}: ${mix.kinds[x.key]} (${Math.round((mix.kinds[x.key] / mix.total) * 100)}%)`,
                                ),
                                lean ? `More than half are ${EVIDENCE_KINDS.find((x) => x.key === lean)!.label.toLowerCase()}` : "No kind holds more than half",
                              ]
                        }
                      />,
                    );
                  }}
                  onMouseLeave={tip.hide}
                  style={{ fontSize: 11.5, lineHeight: `${LINE}px`, color: muted(65), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {sort !== "matrix" && sort !== "total" ? (
                    <>
                      <strong style={{ fontWeight: 600, color: "var(--color-navy)" }}>
                        {scale === "share"
                          ? `${mix.total ? Math.round((mix.kinds[sort] / mix.total) * 100) : 0}%`
                          : mix.kinds[sort]}{" "}
                        {EVIDENCE_KINDS.find((k) => k.key === sort)!.label.toLowerCase()}
                      </strong>
                      <span className="mono" style={{ fontSize: 10.5, marginLeft: 6 }}>
                        {scale === "share" ? `${mix.kinds[sort]} of ${mix.total}` : `of ${mix.total}`}
                      </span>
                    </>
                  ) : (
                    <>
                      {lean ? <strong style={{ fontWeight: 600, color: "var(--color-navy)" }}>{LEAN[lean]}</strong> : "Mixed"}
                      <span className="mono" style={{ fontSize: 10.5, marginLeft: 6 }}>
                        {mix.total} codes
                      </span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {tip.node}
      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: muted(65) }}>
        {kindOrder.map((k) => (
          <span key={k.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: focusKind === k.key ? 600 : undefined }}>
            <span style={{ width: 12, height: 10, borderRadius: 2, background: colorOf(k) }} />
            {k.label}
            <span style={{ color: muted(45) }}>({k.types.join(", ")})</span>
          </span>
        ))}
      </div>
      <p className="meta" style={{ margin: 0, fontSize: 11.5 }}>
        Count: bar length is how much evidence a theme has. Share: every bar is 100%, to compare what it&apos;s made of, and
        sorting ranks by share. Sorting by a
        group brings it to the front of every bar. Click a row to select its theme in every chart, its name to read it in full, a segment for those quotes.
      </p>
    </div>
  );
}
