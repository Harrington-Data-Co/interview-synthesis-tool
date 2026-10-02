"use client";

import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import { withBase } from "@/lib/basePath";

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
    <Drawer
      kicker={kicker}
      title={title}
      description={description}
      summary={
        <>
          {total} code{total === 1 ? "" : "s"}
          {grouping && ` from ${ivs} interview${ivs === 1 ? "" : "s"}`}
        </>
      }
      onClose={onClose}
    >
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
                    href={withBase(`/transcripts/${id}`)}
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
                        href={withBase(`/transcripts/${id}#L${q.start}`)}
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
    </Drawer>
  );
}
