"use client";

import { useEffect } from "react";

/** Marks an element whose clicks are its own business (a row, a dot, a
 *  ribbon, the drawer), so a click there doesn't count as clicking off the
 *  selection. Buttons, links and form controls count already. */
export const KEEP = { "data-keep-selection": "" } as const;
const KEEPERS = "[data-keep-selection], button, a, input, label, select, textarea, [role=button], [role=dialog]";

/** Clear a selection when the click lands on nothing in particular. Runs
 *  after React's own handlers, so a click that selects has already done so. */
export function useClickOff(active: boolean, clear: () => void) {
  useEffect(() => {
    if (!active) return;
    const off = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(KEEPERS)) clear();
    };
    document.addEventListener("click", off);
    return () => document.removeEventListener("click", off);
  }, [active, clear]);
}

/** A selection's bar: a navy pill pinned to the bottom of the window while
 *  something is selected, with what's selected and what can be done with
 *  it. The corpus charts and the People table use it. */
export function SelectionBar({ label = "Selected", children }: { label?: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      {...KEEP}
      style={{
        position: "fixed",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        zIndex: 55,
        maxWidth: "min(860px, calc(100vw - 32px))",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "8px 8px 8px 16px",
        background: "var(--color-navy)",
        color: "#FFFFFF",
        borderRadius: "var(--radius-pill)",
        boxShadow: "var(--shadow-lg)",
        fontSize: 12.5,
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--color-navy-muted)", fontWeight: 700, flex: "none" }}>{label.toUpperCase()}</span>
      {children}
    </div>
  );
}

/** The pill's buttons: a solid one for the main action, an outline for the rest. */
export const pillButton = (solid: boolean): React.CSSProperties => ({
  fontSize: 11.5,
  padding: "3px 12px",
  borderRadius: "var(--radius-pill)",
  flex: "none",
  ...(solid
    ? { color: "var(--color-navy)", background: "#FFFFFF", borderColor: "#FFFFFF" }
    : { color: "#FFFFFF", borderColor: "rgba(255,255,255,0.35)" }),
});
