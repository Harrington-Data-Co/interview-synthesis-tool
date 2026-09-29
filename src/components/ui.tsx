"use client";

import { useEffect, useRef } from "react";

/** A menu anchored under (or, near the bottom of the window, over) the element
 *  that opened it. Fixed positioning, so a scrolling table can't clip it.
 *  Closes on a click outside, Escape, or a resize. */
export function Popover({
  anchor,
  onClose,
  width = 280,
  label,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  width?: number;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const openUp = window.innerHeight - anchor.bottom < 320 && anchor.top > 320;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="panel"
      style={{
        position: "fixed",
        zIndex: 50,
        width,
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
        ...(openUp ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }),
        maxHeight: 420,
        overflow: "auto",
        background: "var(--color-surface)",
        boxShadow: "var(--shadow-lg)",
        padding: "6px 0",
      }}
    >
      {children}
    </div>
  );
}

/** A full-width row in a Popover menu. */
export function MenuItem({
  onClick,
  disabled,
  checked,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** Shows a ✓ gutter; omit for items that aren't choices. */
  checked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        width: "100%",
        gap: 8,
        alignItems: "center",
        textAlign: "left",
        border: 0,
        background: "none",
        padding: "5px 12px",
        fontSize: 13,
        cursor: "pointer",
        color: "var(--color-text)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-accent-tint-soft)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {checked !== undefined && (
        <span style={{ width: 12, flex: "none", color: "var(--color-accent-800)" }}>{checked ? "✓" : ""}</span>
      )}
      {children}
    </button>
  );
}

/** A small uppercase heading inside a Popover. */
export function MenuHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", padding: "6px 12px 2px" }}>
      <span className="kicker" style={{ fontSize: 10 }}>
        {children}
      </span>
      {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
    </div>
  );
}

/** Modal in the prototype's style (Discovery Workspace.dc.html, Workspace
 *  dialog). Omit onClose to make it undismissable while work is in flight. */
export function Dialog({
  title,
  onClose,
  width = 560,
  children,
}: {
  title: string;
  onClose?: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: "var(--space-6)" }}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: `min(${width}px,100%)`,
          maxHeight: "86vh",
          overflow: "auto",
          background: "var(--color-bg)",
          padding: "var(--space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)" }}>
          <h3 style={{ fontWeight: 700, margin: 0, fontSize: 23 }}>{title}</h3>
          {onClose && (
            <button onClick={onClose} className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: 12 }}>
              Close
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/** Same treatment as the sign-in page's error box. */
export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      style={{
        padding: "var(--space-2) var(--space-3)",
        border: `1px solid var(${tone === "error" ? "--color-accent-600" : "--color-accent-400"})`,
        background: "var(--color-accent-100)",
        fontSize: 12.5,
        lineHeight: 1.5,
        color: "var(--color-navy)",
      }}
    >
      {children}
    </div>
  );
}
