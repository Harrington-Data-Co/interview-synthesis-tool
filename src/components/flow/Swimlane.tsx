"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { DATA_COLORS } from "@/lib/palette";
import type { FlowStepView, FlowView } from "@/lib/flow/load";

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
export const PAIN = DATA_COLORS[4];
const LANE_W = 160;
// A column shrinks to this before the map scrolls sideways, so an eight-step
// process still fits a laptop screen.
const COL_W = 140;

/** Does a step rest on a Pain or Constraint code? Then it's a pain point. */
export const isPain = (s: FlowStepView, typeOf: Map<string, string>) =>
  s.codeIds.some((id) => typeOf.get(id) === "Pain" || typeOf.get(id) === "Constraint");

type Arrow = { d: string; key: string };

/** A process map drawn as a swimlane: lanes are rows, positions are columns,
 *  arrows run from each step to the steps at the next position. Waits are
 *  filled; decisions are outlined; steps resting on Pain or Constraint codes
 *  carry a pain marker. */
export function Swimlane({
  flow,
  typeOf,
  selected,
  onPick,
  editor,
  onAddAt,
  laneTools,
}: {
  flow: FlowView;
  typeOf: Map<string, string>;
  selected: string | null;
  onPick: (stepId: string) => void;
  editor: boolean;
  /** Add a step in an empty cell (that lane, that position). */
  onAddAt: (laneId: string, position: number) => void;
  /** Lane editing controls, drawn in the lane's header when given. */
  laneTools?: (lane: { id: string; name: string }, index: number) => React.ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);

  const positions = [...new Set(flow.steps.map((s) => s.position))].sort((a, b) => a - b);
  const at = new Map(flow.steps.map((s) => [`${s.laneId}:${s.position}`, s]));

  const measure = useCallback(() => {
    const root = content.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const rect = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => rect.set(el.dataset.step!, el.getBoundingClientRect()));
    const next: Arrow[] = [];
    for (let i = 0; i + 1 < positions.length; i++) {
      const from = flow.steps.filter((s) => s.position === positions[i]);
      const to = flow.steps.filter((s) => s.position === positions[i + 1]);
      for (const a of from)
        for (const b of to) {
          const A = rect.get(a.id);
          const B = rect.get(b.id);
          if (!A || !B) continue;
          const x1 = A.right - origin.left;
          const y1 = A.top + A.height / 2 - origin.top;
          const x2 = B.left - origin.left - 2;
          const y2 = B.top + B.height / 2 - origin.top;
          const mx = (x1 + x2) / 2;
          next.push({ key: `${a.id}>${b.id}`, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` });
        }
    }
    setArrows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  useLayoutEffect(() => {
    measure();
    const root = content.current;
    if (!root) return;
    const watch = new ResizeObserver(measure);
    watch.observe(root);
    return () => watch.disconnect();
  }, [measure]);

  const cols = `${LANE_W}px repeat(${Math.max(positions.length, 1)}, minmax(${COL_W}px, 1fr))`;

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--line-2)", borderRadius: "var(--radius)", background: "var(--color-surface)" }}>
      <div ref={content} style={{ position: "relative", minWidth: LANE_W + Math.max(positions.length, 1) * COL_W }}>
        {/* Sized to the drawing, never to a measurement: a measured width could
            outlive a longer map and keep the page that wide. */}
        <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1, overflow: "visible" }}>
          <defs>
            <marker id={`arrow-${flow.id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--color-navy)" opacity={0.55} />
            </marker>
          </defs>
          {arrows.map((a) => (
            <path key={a.key} d={a.d} fill="none" stroke="var(--color-navy)" strokeOpacity={0.4} strokeWidth={1.3} markerEnd={`url(#arrow-${flow.id})`} />
          ))}
        </svg>

        <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid var(--line-2)", background: "var(--color-bg-soft)" }}>
          <span className="kicker" style={{ fontSize: 9.5, padding: "8px 12px", position: "sticky", left: 0, background: "var(--color-bg-soft)", zIndex: 3 }}>
            Who
          </span>
          {positions.map((p, i) => (
            <span key={p} className="mono" style={{ fontSize: 10, color: muted(50), padding: "8px 12px" }}>
              {i + 1}
            </span>
          ))}
        </div>

        {flow.lanes.map((lane, li) => (
          <div
            key={lane.id}
            style={{
              display: "grid",
              gridTemplateColumns: cols,
              borderBottom: li < flow.lanes.length - 1 ? "1px solid var(--line-2)" : undefined,
              background: li % 2 ? "var(--color-bg-soft)" : "var(--color-surface)",
              // A lane with no steps yet stays slim rather than a tall empty band.
              minHeight: flow.steps.some((s) => s.laneId === lane.id) ? 92 : 52,
            }}
          >
            <div
              style={{
                position: "sticky",
                left: 0,
                zIndex: 3,
                background: "inherit",
                borderRight: "1px solid var(--line-2)",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-navy)" }}>
                {lane.name}
              </span>
              {laneTools?.(lane, li)}
            </div>
            {positions.map((p) => {
              const s = at.get(`${lane.id}:${p}`);
              return (
                <div key={p} style={{ padding: "8px", display: "flex", alignItems: "center", position: "relative", zIndex: 2 }}>
                  {s ? (
                    <StepCard step={s} pain={isPain(s, typeOf)} picked={selected === s.id} onPick={() => onPick(s.id)} />
                  ) : editor ? (
                    <button
                      className="btn btn-ghost reveal-on-hover"
                      aria-label={`Add a step for ${lane.name} at position ${positions.indexOf(p) + 1}`}
                      onClick={() => onAddAt(lane.id, p)}
                      style={{ width: "100%", minHeight: 44, border: `1px dashed ${muted(25)}`, color: muted(50), fontSize: 16 }}
                    >
                      +
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {!flow.lanes.length && (
          <p className="meta" style={{ margin: 0, padding: "var(--space-4)" }}>
            No lanes yet. Add the roles, teams or systems that do the work.
          </p>
        )}
      </div>
    </div>
  );
}

function StepCard({ step, pain, picked, onPick }: { step: FlowStepView; pain: boolean; picked: boolean; onPick: () => void }) {
  const wait = step.kind === "wait";
  const decision = step.kind === "decision";
  return (
    <button
      data-step={step.id}
      onClick={onPick}
      aria-pressed={picked}
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        width: "100%",
        minHeight: 64,
        padding: "7px 9px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        borderRadius: 4,
        background: wait ? "var(--color-navy)" : "var(--color-surface)",
        color: wait ? "#FFFFFF" : "var(--color-text)",
        border: decision ? "2px solid var(--color-accent-600)" : `1px solid ${wait ? "var(--color-navy)" : "var(--line-4)"}`,
        boxShadow: picked ? "0 0 0 3px var(--color-accent-400)" : "var(--shadow-xs)",
      }}
    >
      <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, color: wait ? "var(--color-navy-muted)" : decision ? "var(--color-accent-700)" : muted(45) }}>
        {decision ? "◆ Decision" : wait ? "Wait" : "Task"}
        {pain && (
          <span title="Rests on a Pain or Constraint code" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, color: wait ? "#FFFFFF" : PAIN, letterSpacing: "0.04em" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: PAIN, boxShadow: wait ? "0 0 0 1.5px #FFFFFF" : undefined }} />
            pain point
          </span>
        )}
      </span>
      <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600 }}>{step.label}</span>
      <span className="mono" style={{ fontSize: 9.5, opacity: 0.7, marginTop: "auto" }}>
        {step.codeIds.length} code{step.codeIds.length === 1 ? "" : "s"}
        {step.note ? " · note" : ""}
      </span>
    </button>
  );
}
