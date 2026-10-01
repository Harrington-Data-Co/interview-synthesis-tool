"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { layers } from "@/lib/arch/layout";
import type { ArchMapView } from "@/lib/arch/load";
import { DATA_COLORS } from "@/lib/palette";

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
export const PAIN = DATA_COLORS[4];
const KIND_LABEL: Record<string, string> = {
  system: "System",
  spreadsheet: "Spreadsheet",
  document: "Document",
  communication: "Communication",
  manual: "Manual",
  external: "Outside party",
};
const CARD_W = 190;
const COL_GAP = 104;
/** Taller columns split into side-by-side stacks of at most this many. */
const STACK = 8;

export type Selection = { kind: "node" | "flow" | "gap"; id: string } | null;
type Edge = { id: string; d: string; mx: number; my: number };

/** The systems as described: columns so data reads left to right, a card
 *  per system (dashed when it's a workaround people invented, a pain marker
 *  when it rests on a Pain or Constraint code), and a line per flow (green
 *  when the systems move it themselves, grey when a person does). Picking a
 *  system lights its flows and names what they carry; picking a gap lights
 *  the systems and flows that share its evidence. */
export function ArchDiagram({ map, typeOf, selected, onSelect }: { map: ArchMapView; typeOf: Map<string, string>; selected: Selection; onSelect: (s: Selection) => void }) {
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [hover, setHover] = useState<string | null>(null);

  // Systems no flow touches sit in a strip underneath rather than piling
  // into the first column.
  const joined = new Set(map.flows.flatMap((f) => [f.from, f.to]));
  const linked = map.nodes.filter((n) => joined.has(n.id));
  const loose = map.nodes.filter((n) => !joined.has(n.id));
  const layer = layers(
    linked.map((n) => n.id),
    map.flows.map((f) => [f.from, f.to]),
  );
  const columns: string[][] = [];
  for (const n of linked) (columns[layer[n.id]] ??= []).push(n.id);
  const stacks = (col: string[]) => Array.from({ length: Math.ceil(col.length / STACK) }, (_, i) => col.slice(i * STACK, (i + 1) * STACK));
  const nodeOf = new Map(map.nodes.map((n) => [n.id, n]));

  // What's lit: a system and its flows (and the systems at their other ends),
  // a flow and its two ends, or a gap and everything sharing its codes.
  const focus = hover ? ({ kind: "node", id: hover } as const) : selected;
  const lit = new Set<string>();
  if (focus?.kind === "node") {
    lit.add(focus.id);
    for (const f of map.flows) if (f.from === focus.id || f.to === focus.id) [f.id, f.from, f.to].forEach((x) => lit.add(x));
  } else if (focus?.kind === "flow") {
    const f = map.flows.find((x) => x.id === focus.id);
    if (f) [f.id, f.from, f.to].forEach((x) => lit.add(x));
  } else if (focus?.kind === "gap") {
    const g = map.gaps.find((x) => x.id === focus.id);
    const codes = new Set(g?.codeIds ?? []);
    for (const n of map.nodes) if (n.codeIds.some((c) => codes.has(c))) lit.add(n.id);
    for (const f of map.flows) if (f.codeIds.some((c) => codes.has(c))) [f.id, f.from, f.to].forEach((x) => lit.add(x));
  }
  const on = (id: string) => !focus || lit.has(id);

  const measure = useCallback(() => {
    const root = content.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const rect = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => rect.set(el.dataset.node!, el.getBoundingClientRect()));
    const next: Edge[] = [];
    for (const f of map.flows) {
      const A = rect.get(f.from);
      const B = rect.get(f.to);
      if (!A || !B) continue;
      const forward = B.left > A.right;
      const x1 = (forward ? A.right : A.left) - origin.left;
      const y1 = A.top + A.height / 2 - origin.top;
      const x2 = (forward ? B.left : B.right) - origin.left - (forward ? 3 : -3);
      const y2 = B.top + B.height / 2 - origin.top;
      // Forward flows bend between the columns; others loop out to the side.
      const k = forward ? Math.max(40, (x2 - x1) / 2) : -70;
      next.push({
        id: f.id,
        d: `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`,
        mx: (x1 + x2) / 2 + (forward ? 0 : -52),
        my: (y1 + y2) / 2,
      });
    }
    setEdges(next);
  }, [map]);

  useLayoutEffect(() => {
    measure();
    const root = content.current;
    if (!root) return;
    const watch = new ResizeObserver(measure);
    watch.observe(root);
    return () => watch.disconnect();
  }, [measure]);

  const card = (id: string) => {
    const n = nodeOf.get(id)!;
    const pain = n.codeIds.some((c) => typeOf.get(c) === "Pain" || typeOf.get(c) === "Constraint");
    const picked = selected?.kind === "node" && selected.id === id;
    return (
      <button
        key={id}
        data-node={id}
        onClick={() => onSelect(picked ? null : { kind: "node", id })}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        aria-pressed={picked}
        style={{
          all: "unset",
          boxSizing: "border-box",
          cursor: "pointer",
          width: CARD_W,
          padding: "9px 11px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          borderRadius: 6,
          background: n.official ? "var(--color-surface)" : "var(--color-accent-100)",
          border: `${n.official ? "1px solid var(--line-4)" : "1.5px dashed var(--color-accent-600)"}`,
          boxShadow: picked ? "0 0 0 3px var(--color-accent-400)" : "var(--shadow-xs)",
          opacity: on(id) ? 1 : 0.3,
          transition: "opacity .12s",
        }}
      >
        <span
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            fontSize: 9,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: muted(48),
          }}
        >
          {KIND_LABEL[n.kind] ?? n.kind}
          {!n.official && <span style={{ color: "var(--color-accent-700)" }}>· workaround</span>}
          {pain && (
            <span
              title="Rests on a Pain or Constraint code"
              style={{
                marginLeft: "auto",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: PAIN,
                flex: "none",
              }}
            />
          )}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.25,
            color: "var(--color-navy)",
          }}
        >
          {n.name}
        </span>
      </button>
    );
  };

  const flowOf = new Map(map.flows.map((f) => [f.id, f]));
  // Name what each lit flow carries, unless so many are lit the names would
  // pile up; the drawer lists them all.
  const litFlows = focus ? [...lit].filter((id) => flowOf.has(id)) : [];
  const labelled = new Set(litFlows.length <= 4 ? litFlows : []);

  return (
    <div
      style={{
        overflow: "auto",
        maxHeight: "78vh",
        border: "1px solid var(--line-2)",
        borderRadius: "var(--radius)",
        background: "var(--color-bg-soft)",
      }}
    >
      <div
        ref={content}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 28,
          padding: "28px 40px",
          width: "max-content",
          minWidth: "100%",
          boxSizing: "border-box",
        }}
      >
        <svg
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
            zIndex: 1,
          }}
        >
          <defs>
            <marker id="arch-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
            </marker>
          </defs>
          {edges.map((e) => {
            const f = flowOf.get(e.id)!;
            const hot = !!focus && lit.has(e.id);
            return (
              <path
                key={e.id}
                d={e.d}
                fill="none"
                stroke={f.manual ? "var(--color-navy)" : "var(--color-accent)"}
                strokeWidth={f.manual ? (hot ? 1.8 : 1.1) : hot ? 2.8 : 2.2}
                strokeOpacity={focus ? (hot ? 0.9 : 0.06) : f.manual ? 0.32 : 0.8}
                markerEnd="url(#arch-arrow)"
              />
            );
          })}
        </svg>
        <svg
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
            zIndex: 3,
          }}
        >
          {edges
            .filter((e) => labelled.has(e.id))
            .map((e) => (
              <text
                key={e.id}
                x={e.mx}
                y={e.my}
                textAnchor="middle"
                fontSize="10.5"
                fill="var(--color-navy)"
                style={{
                  paintOrder: "stroke",
                  stroke: "var(--color-bg-soft)",
                  strokeWidth: 4,
                  strokeLinejoin: "round",
                }}
              >
                {(() => {
                  const l = flowOf.get(e.id)!.label;
                  return l.length > 34 ? `${l.slice(0, 32)}…` : l;
                })()}
              </text>
            ))}
        </svg>

        <div style={{ display: "flex", gap: COL_GAP }}>
          {columns.map((col, ci) => (
            <div
              key={ci}
              style={{
                display: "flex",
                gap: 24,
                position: "relative",
                zIndex: 2,
              }}
            >
              {stacks(col ?? []).map((stack, si) => (
                <div
                  key={si}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    justifyContent: "center",
                  }}
                >
                  {stack.map(card)}
                </div>
              ))}
            </div>
          ))}
        </div>
        {loose.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              position: "relative",
              zIndex: 2,
              borderTop: "1px dashed var(--line-3)",
              paddingTop: 16,
            }}
          >
            <span className="kicker" style={{ fontSize: 10 }}>
              Also in use · no flows described
            </span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 14,
                maxWidth: 5 * (CARD_W + 14),
              }}
            >
              {loose.map((n) => card(n.id))}
            </div>
          </div>
        )}
        {!map.nodes.length && (
          <p className="meta" style={{ margin: 0 }}>
            No systems yet.
          </p>
        )}
      </div>
    </div>
  );
}
