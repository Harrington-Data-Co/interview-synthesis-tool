"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { projectHref } from "@/lib/urls";

export const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
export const LINE = 21; // one collapsed row in the corpus charts

/** A theme's name that expands in place: the full title and description,
 *  with a link to it on the Themes tab. Collapsed, it's one line. A click
 *  anywhere in this cell expands or collapses it (the button is there for
 *  the keyboard); it doesn't reach the row, whose own click only selects. */
export function ThemeName({
  projectPath,
  title,
  description,
  proposed,
  expanded,
  onToggle,
}: {
  projectPath: string;
  title: string;
  description: string | null;
  proposed: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3, paddingRight: "var(--space-2)", alignSelf: "stretch" }}
    >
      <button
        aria-expanded={expanded}
        title={expanded ? undefined : title}
        style={{ all: "unset", cursor: "pointer", minWidth: 0, display: "flex", gap: 5, lineHeight: `${LINE}px` }}
      >
        <span
          aria-hidden
          style={{
            width: 9,
            height: LINE,
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 8,
            color: muted(45),
            transform: expanded ? "rotate(90deg)" : undefined,
            transition: "transform .12s",
          }}
        >
          ▶
        </span>
        <span
          style={{
            fontSize: 12,
            fontStyle: proposed ? "italic" : undefined,
            fontWeight: expanded ? 600 : undefined,
            ...(expanded ? { whiteSpace: "normal", lineHeight: 1.45, paddingTop: 2 } : { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }),
          }}
        >
          {title}
        </span>
      </button>
      {expanded && (
        <span style={{ fontSize: 11.5, lineHeight: 1.45, color: muted(65), paddingLeft: 14, paddingBottom: 4 }}>
          {description || (proposed ? "Proposed, not yet confirmed." : "No description.")}{" "}
          <Link href={projectHref(projectPath, "themes")} onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
            Open in Themes →
          </Link>
        </span>
      )}
    </div>
  );
}

/** A theme's reference, outlined dashed while it's only a proposal. */
export function ThemeRef({ text, proposed }: { text: string; proposed: boolean }) {
  return (
    <span
      className="mono"
      title={proposed ? "Proposed: not yet confirmed" : undefined}
      style={{
        justifySelf: "start",
        alignSelf: "start",
        fontSize: 10,
        lineHeight: `${LINE - 6}px`,
        marginTop: 3,
        padding: "0 4px",
        color: "var(--color-accent-700)",
        border: `1px ${proposed ? "dashed" : "solid"} ${proposed ? "var(--color-accent-400)" : "transparent"}`,
      }}
    >
      {text}
    </span>
  );
}

/** Which rows are expanded, with a toggle for one and for all. */
export function useExpanded(ids: string[]) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (id: string) =>
      setOpen((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const all = ids.length > 0 && ids.every((id) => open.has(id));
  return { open, toggle, all, toggleAll: () => setOpen(all ? new Set() : new Set(ids)) };
}

/** Clicking a theme's name: expand or collapse it here, and select it in
 *  every chart (collapsing never clears the selection). A click elsewhere in
 *  the row only toggles the selection. */
export function expandTheme(id: string, select: (ids: string[]) => void, toggle: (id: string) => void) {
  toggle(id);
  select([id]);
}

/** A selected row: tinted, with a bar down its left edge. */
export const selectedRow = { background: "var(--color-accent-tint)", boxShadow: "inset 3px 0 0 var(--color-accent-700)" } as const;

type TipState = { x: number; y: number; content: React.ReactNode } | null;

/** A hover tooltip that follows the pointer, kept inside the window. */
export function useTip() {
  const [tip, setTip] = useState<TipState>(null);
  const show = useCallback((e: React.MouseEvent, content: React.ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }), []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: Math.min(tip.x + 14, (typeof window === "undefined" ? 1200 : window.innerWidth) - 300),
        top: tip.y + 14,
        width: 280,
        zIndex: 70,
        pointerEvents: "none",
        background: "var(--color-navy)",
        color: "#FFFFFF",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-md)",
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}

/** The lines inside a tooltip: a heading, then quieter detail. */
export function TipBody({ heading, lines }: { heading: React.ReactNode; lines: React.ReactNode[] }) {
  return (
    <>
      <div style={{ fontWeight: 700, marginBottom: 3 }}>{heading}</div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} style={{ color: "rgba(255,255,255,0.78)" }}>
          {l}
        </div>
      ))}
    </>
  );
}

/** Any element with a hover tooltip saying what it shows, for parts of the
 *  page rendered on the server. */
export function HoverTip({
  heading,
  lines,
  as: Tag = "div",
  style,
  className,
  children,
}: {
  heading: React.ReactNode;
  lines: React.ReactNode[];
  as?: "div" | "span";
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  const tip = useTip();
  return (
    <Tag className={className} style={style} onMouseMove={(e) => tip.show(e, <TipBody heading={heading} lines={lines} />)} onMouseLeave={tip.hide}>
      {children}
      {tip.node}
    </Tag>
  );
}
