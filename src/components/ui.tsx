"use client";

import { useEffect } from "react";

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
