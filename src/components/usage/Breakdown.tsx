"use client";

import Link from "next/link";
import { TipBody, useTip } from "@/components/corpus/bits";
import { compact, money, type Slice } from "@/lib/usage";
import { DATA_COLORS, OTHER_COLOR } from "@/lib/palette";

/** Spend broken down one way (by project, person or pass): a row per slice,
 *  its bar in one hue (grey for Other), the amount at the bar's tip, and
 *  the slice's name a link that narrows the whole page to it. */
export function Breakdown({ title, slices, hrefFor }: { title: string; slices: Slice[]; hrefFor: (key: string) => string | null }) {
  const { show, hide, node } = useTip();
  const max = Math.max(...slices.map((s) => s.spend), 0);
  return (
    <section className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
      <span className="kicker">{title}</span>
      {!slices.length && <p className="meta" style={{ margin: 0 }}>No runs.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }} onMouseLeave={hide}>
        {slices.map((s) => {
          const href = s.other ? null : hrefFor(s.key);
          return (
            <div
              key={s.key}
              onMouseMove={(e) =>
                show(e, <TipBody heading={s.label} lines={[`${money(s.spend)} spent`, `${s.runs} run${s.runs === 1 ? "" : "s"}`, `${compact(s.tokens)} tokens`]} />)
              }
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {href ? (
                  <Link href={href} style={{ color: "inherit" }}>
                    {s.label}
                  </Link>
                ) : (
                  <span className={s.other ? "meta" : undefined}>{s.label}</span>
                )}
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
            </div>
          );
        })}
      </div>
      {node}
    </section>
  );
}
