"use client";

import { TipBody, useTip } from "@/components/corpus/bits";
import { money, type Bucket } from "@/lib/usage";
import { DATA_COLORS } from "@/lib/palette";
import { OPENS_DRAWER, useUsageDrawer } from "./UsageDrawer";

const HEIGHT = 160;

/** Spend per day (or week) as columns: one series, one hue, grown from a
 *  shared baseline, with three recessive gridlines and a hover tooltip on
 *  every column (its spend, runs and failures). */
export function SpendOverTime({ buckets, grain }: { buckets: Bucket[]; grain: "day" | "week" }) {
  const { show, hide, node } = useTip();
  const { open, selected } = useUsageDrawer();
  const max = Math.max(...buckets.map((b) => b.spend), 0);
  const top = niceCeiling(max);
  const ticks = top > 0 ? [top, top / 2, 0] : [0];
  // Label about six columns along the bottom, always the last.
  const every = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8 }}>
      <div style={{ position: "relative", height: HEIGHT }}>
        {ticks.map((t) => (
          <span key={t} className="meta mono" style={{ position: "absolute", right: 0, top: top ? (1 - t / top) * HEIGHT - 7 : HEIGHT - 7, fontSize: 11 }}>
            {money(t).replace(".00", "")}
          </span>
        ))}
      </div>
      <div>
        <div
          role="img"
          aria-label={`Spend per ${grain}, ${buckets.length} ${grain}s`}
          onMouseLeave={hide}
          style={{ position: "relative", height: HEIGHT, display: "flex", alignItems: "flex-end", gap: 2, borderBottom: "1px solid var(--line-3)" }}
        >
          {ticks.slice(0, -1).map((t) => (
            <span key={t} aria-hidden style={{ position: "absolute", left: 0, right: 0, top: (1 - t / top) * HEIGHT, borderTop: "1px solid var(--line-1)" }} />
          ))}
          {buckets.map((b) => {
            const isOpen = selected?.match.bucket === b.key && Object.keys(selected.match).length === 1;
            return (
            <div
              key={b.key}
              {...(b.runs ? OPENS_DRAWER : {})}
              onClick={() => b.runs && open({ kicker: grain === "day" ? "Spend on" : "Spend in the week of", title: b.label.replace("Week of ", ""), match: { bucket: b.key } })}
              onMouseMove={(e) =>
                show(e, <TipBody heading={b.label} lines={[`${money(b.spend)} spent`, `${b.runs} run${b.runs === 1 ? "" : "s"}`, b.failed ? `${b.failed} failed` : "", b.runs ? "Click for its runs" : ""]} />)
              }
              style={{
                flex: 1,
                height: "100%",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                cursor: b.runs ? "pointer" : "default",
                background: isOpen ? "var(--color-accent-tint)" : undefined,
                borderRadius: 4,
              }}
            >
              {b.spend > 0 && (
                <div
                  style={{
                    width: "100%",
                    maxWidth: 24,
                    height: Math.max(2, (b.spend / top) * HEIGHT),
                    background: DATA_COLORS[0],
                    borderRadius: "4px 4px 0 0",
                  }}
                />
              )}
            </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
          {buckets.map((b, i) => (
            <span key={b.key} className="meta" style={{ flex: 1, fontSize: 11, textAlign: "center", whiteSpace: "nowrap", overflow: "visible" }}>
              {i % every === 0 || i === buckets.length - 1 ? b.label.replace("Week of ", "") : ""}
            </span>
          ))}
        </div>
      </div>
      {node}
    </div>
  );
}

/** A round number at or above n for the axis: 1, 2, 5, 10, 20, 50… */
function niceCeiling(n: number): number {
  if (n <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p;
}
