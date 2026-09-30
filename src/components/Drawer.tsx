"use client";

/** The side drawer every view opens: a navy header (kicker, title, an
 *  optional line or two, a small summary line) and a scrolling body. The
 *  evidence drawer and the person drawer are both this. Whoever opens it
 *  handles Escape. */
export function Drawer({
  kicker,
  title,
  description,
  summary,
  onClose,
  children,
}: {
  kicker: string;
  title: string;
  description?: React.ReactNode;
  summary?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      role="dialog"
      aria-label={title}
      className="panel"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(480px, 100vw)",
        zIndex: 60,
        borderRadius: 0,
        boxShadow: "var(--shadow-lg)",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface)",
      }}
    >
      <header style={{ background: "var(--color-navy)", color: "#FFFFFF", padding: "var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--color-navy-muted)" }}>
            {kicker.toUpperCase()}
          </span>
          <h3
            style={{
              fontSize: 16,
              margin: "3px 0 2px",
              color: "#FFFFFF",
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={title}
          >
            {title}
          </h3>
          {description && <p style={{ margin: "2px 0 6px", fontSize: 12.5, lineHeight: 1.45, color: "rgba(255,255,255,0.85)" }}>{description}</p>}
          {summary && <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)" }}>{summary}</span>}
        </div>
        <button className="btn" onClick={onClose} aria-label="Close" style={{ color: "#FFFFFF", borderColor: "rgba(255,255,255,0.35)", padding: "2px 9px", fontSize: 13 }}>
          ✕
        </button>
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5, 20px)" }}>{children}</div>
    </aside>
  );
}
