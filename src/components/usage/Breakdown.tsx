"use client";

import { TipBody, useTip } from "@/components/corpus/bits";
import { compact, money, type Slice } from "@/lib/usage";
import { DATA_COLORS, OTHER_COLOR } from "@/lib/palette";
import { OPENS_DRAWER, useUsageDrawer, type UsageSelection } from "./UsageDrawer";

/** A slice and what clicking it opens: the drawer on its runs (null for
 *  Other, which is many things). Worked out by the page, since a server page
 *  can only hand data to this. */
export type LinkedSlice = Slice & { selection: UsageSelection | null };

/** Spend broken down one way (by client, project, person or pass): a row
 *  per slice, its bar in one hue (grey for Other), the amount at the bar's
 *  tip. Clicking a row opens its runs in the drawer. */
export function Breakdown({ title, slices }: { title: string; slices: LinkedSlice[] }) {
  const { show, hide, node } = useTip();
  const { open, selected } = useUsageDrawer();
  const max = Math.max(...slices.map((s) => s.spend), 0);
  return (
    <section className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
      <span className="kicker">{title}</span>
      {!slices.length && <p className="meta" style={{ margin: 0 }}>No runs.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }} onMouseLeave={hide}>
        {slices.map((s) => {
          const isOpen = !!s.selection && !!selected && JSON.stringify(selected.match) === JSON.stringify(s.selection.match);
          const body = (
            <>
              <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isOpen ? 700 : 400 }} className={s.other ? "meta" : undefined}>
                {s.label}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      height: 10,
                      width: `${max ? Math.max(1, (s.spend / max) * 100) : 0}%`,
                      background: s.other ? OTHER_COLOR : DATA_COLORS[0],
                      borderRadius: "0 4px 4px 0",
                    }}
                  />
                </span>
                <span className="mono" style={{ fontSize: 12.5, minWidth: 64, textAlign: "right" }}>
                  {money(s.spend)}
                </span>
              </span>
            </>
          );
          const tip = (e: React.MouseEvent) =>
            show(e, <TipBody heading={s.label} lines={[`${money(s.spend)} spent`, `${s.runs} run${s.runs === 1 ? "" : "s"}`, `${compact(s.tokens)} tokens`, s.selection ? "Click for its runs" : ""]} />);
          const rowStyle = {
            display: "flex",
            flexDirection: "column" as const,
            gap: 4,
            padding: "4px 6px",
            margin: "0 -6px",
            borderRadius: "var(--radius)",
            background: isOpen ? "var(--color-accent-tint)" : undefined,
          };
          return s.selection ? (
            <button
              key={s.key}
              type="button"
              {...OPENS_DRAWER}
              className="usage-row"
              onClick={() => open(s.selection!)}
              onMouseMove={tip}
              style={{ ...rowStyle, border: 0, font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", background: rowStyle.background ?? "none", width: "calc(100% + 12px)" }}
            >
              {body}
            </button>
          ) : (
            <div key={s.key} onMouseMove={tip} style={rowStyle}>
              {body}
            </div>
          );
        })}
      </div>
      {node}
    </section>
  );
}
