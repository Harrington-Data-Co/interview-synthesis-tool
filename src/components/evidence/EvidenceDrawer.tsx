"use client";

import Link from "next/link";

export type DrawerQuote = {
  id: string;
  transcriptId: string;
  ref: string;
  type: string;
  label: string;
  verbatim: string;
  start: number;
  end: number;
};
export type DrawerInterview = { id: string; key: string; title: string; participant: string | null };
/** One block of the drawer: a theme's codes, or codes cited on their own.
 *  The heading is shown only when the drawer holds more than one block. */
export type DrawerSection = { key: string; heading?: { ref?: string; title: string; note?: string }; quotes: DrawerQuote[] };

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** The side drawer of supporting evidence: quotes grouped by section, then
 *  by interview, each linking to its line in the transcript. The corpus
 *  charts, the memo and the interview note open it; a note's evidence is all
 *  from one interview, so it passes no interviews and skips that grouping.
 *  Whoever opens it handles Escape. */
export function EvidenceDrawer({
  kicker,
  title,
  description,
  sections,
  interviews,
  onClose,
}: {
  kicker: string;
  title: string;
  /** A line or two under the title, such as a theme's description. */
  description?: string | null;
  sections: DrawerSection[];
  interviews?: Map<string, DrawerInterview>;
  onClose: () => void;
}) {
  const grouped = sections.map((s) => {
    const byInterview = new Map<string, DrawerQuote[]>();
    for (const q of s.quotes) (byInterview.get(q.transcriptId) ?? byInterview.set(q.transcriptId, []).get(q.transcriptId)!).push(q);
    return { ...s, byInterview: [...byInterview] };
  });
  const all = sections.flatMap((s) => s.quotes);
  const total = new Set(all.map((q) => q.id)).size;
  const ivs = new Set(all.map((q) => q.transcriptId)).size;
  const grouping = !!interviews;

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
          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)" }}>
            {total} code{total === 1 ? "" : "s"}
            {grouping && ` from ${ivs} interview${ivs === 1 ? "" : "s"}`}
          </span>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close" style={{ color: "#FFFFFF", borderColor: "rgba(255,255,255,0.35)", padding: "2px 9px", fontSize: 13 }}>
          ✕
        </button>
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5, 20px)" }}>
        {grouped.map(({ key, heading, byInterview }) => (
          <section key={key} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {grouped.length > 1 && heading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingBottom: 4, borderBottom: "2px solid var(--color-navy)" }}>
                <span style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  {heading.ref && (
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--color-accent-700)" }}>
                      {heading.ref}
                    </span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)" }}>{heading.title}</span>
                </span>
                {heading.note && <span style={{ fontSize: 11, color: muted(60) }}>{heading.note}</span>}
              </div>
            )}
            {!byInterview.length && <span className="meta">No codes.</span>}
            {byInterview.map(([id, qs]) => {
              const iv = interviews?.get(id);
              return (
                <div key={id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {grouping && (
                    <Link
                      href={`/transcripts/${id}`}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--color-navy)",
                        textDecoration: "none",
                        borderBottom: "1px solid var(--color-divider)",
                        paddingBottom: 4,
                      }}
                    >
                      <span className="mono" style={{ color: "var(--color-accent-700)", marginRight: 6 }}>
                        {iv?.key}
                      </span>
                      {iv?.participant ?? iv?.title}
                    </Link>
                  )}
                  {qs.map((q) => (
                    <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="mono" style={{ fontSize: 9.5, padding: "1px 5px", background: "var(--color-accent-200)", color: "var(--color-navy)", flex: "none" }}>
                          {q.ref}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{q.label}</span>
                        <Link
                          href={`/transcripts/${id}#L${q.start}`}
                          className="mono"
                          style={{ fontSize: 10, marginLeft: "auto", color: "var(--color-accent-700)", whiteSpace: "nowrap" }}
                        >
                          L{q.start}
                          {q.end > q.start ? `–${q.end}` : ""} →
                        </Link>
                      </div>
                      <blockquote
                        style={{ margin: 0, padding: "4px 0 4px 10px", borderLeft: "2px solid var(--color-accent-300)", fontSize: 12.5, lineHeight: 1.5, color: muted(80) }}
                      >
                        “{q.verbatim}”
                      </blockquote>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
