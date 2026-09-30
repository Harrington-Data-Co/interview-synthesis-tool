"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";

export type CorpusQuote = {
  id: string;
  transcriptId: string;
  ref: string;
  type: string;
  label: string;
  verbatim: string;
  start: number;
  end: number;
};
export type CorpusThemeInfo = { id: string; ref: string; title: string; description: string | null; proposed: boolean };
export type CorpusInterviewInfo = { id: string; key: string; title: string; participant: string | null };

/** What to show in the quotes panel: one or more themes' codes, each
 *  optionally narrowed to some interviews or some code types. */
export type PanelSpec = {
  kicker: string;
  title: string;
  parts: { themeId: string; transcriptIds?: string[]; types?: readonly string[] }[];
};

type Corpus = {
  projectId: string;
  themes: Map<string, CorpusThemeInfo>;
  interviews: Map<string, CorpusInterviewInfo>;
  quotes: Record<string, CorpusQuote[]>; // by theme, in interview then line order
  panel: PanelSpec | null;
  openPanel: (spec: PanelSpec) => void;
  /** The selected theme, or pair of themes (a chord), shared by every chart:
   *  pick it in one and it's highlighted in all of them. */
  selected: string[];
  isSelected: (id: string) => boolean;
  /** Select these themes, or clear them if they're already the selection. */
  toggleSelect: (ids: string[]) => void;
  /** Select these themes, keeping them selected if they already are. */
  select: (ids: string[]) => void;
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

const Ctx = createContext<Corpus | null>(null);

export function useCorpus(): Corpus {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCorpus needs a CorpusProvider.");
  return c;
}

/** Marks an element whose clicks are its own business (a row, a dot, a
 *  ribbon, the quotes panel), so a click there doesn't count as clicking off
 *  the selection. Buttons, links and form controls count already. */
export const KEEP = { "data-keep-selection": "" } as const;
const KEEPERS = "[data-keep-selection], button, a, input, label, select, textarea, [role=button], [role=dialog]";

/** The corpus views' shared data (themes, interviews, each theme's quotes),
 *  the selection they share, and the one quotes panel every chart opens.
 *  Escape closes the panel, or clears the selection when no panel is open;
 *  a click on nothing in particular clears the selection too. */
export function CorpusProvider({
  projectId,
  themes,
  interviews,
  quotes,
  children,
}: {
  projectId: string;
  themes: CorpusThemeInfo[];
  interviews: CorpusInterviewInfo[];
  quotes: Record<string, CorpusQuote[]>;
  children: React.ReactNode;
}) {
  const [panel, setPanel] = useState<PanelSpec | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const value = useMemo<Corpus>(
    () => ({
      projectId,
      themes: new Map(themes.map((t) => [t.id, t])),
      interviews: new Map(interviews.map((i) => [i.id, i])),
      quotes,
      panel,
      openPanel: setPanel,
      selected,
      isSelected: (id) => selected.includes(id),
      toggleSelect: (ids) => setSelected((cur) => (same(cur, ids) ? [] : ids)),
      select: setSelected,
    }),
    [projectId, themes, interviews, quotes, panel, selected],
  );
  const close = useCallback(() => setPanel(null), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (panel) setPanel(null);
      else setSelected([]);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [panel]);
  useEffect(() => {
    if (!selected.length) return;
    // Runs after React's own handlers, so a click that selects has already
    // done so; anything that isn't a chart element or a control clears.
    const off = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(KEEPERS)) setSelected([]);
    };
    document.addEventListener("click", off);
    return () => document.removeEventListener("click", off);
  }, [selected.length]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {selected.length > 0 && <SelectionBar />}
      {panel && <QuotePanel spec={panel} onClose={close} />}
    </Ctx.Provider>
  );
}

/** What's selected, pinned to the bottom of the window while it is, with
 *  its quotes one click away. For a pair, the quotes are from the
 *  interviews the two themes share. */
function SelectionBar() {
  const { selected, themes, quotes, openPanel, select } = useCorpus();
  const picked = selected.map((id) => themes.get(id)).filter((t): t is CorpusThemeInfo => !!t);
  const pair = picked.length === 2;
  const shared = pair
    ? [...new Set((quotes[picked[0].id] ?? []).map((q) => q.transcriptId))].filter((id) =>
        (quotes[picked[1].id] ?? []).some((q) => q.transcriptId === id),
      )
    : undefined;
  const view = () =>
    openPanel(
      pair
        ? {
            kicker: `${picked[0].ref} + ${picked[1].ref} · ${shared!.length} shared interview${shared!.length === 1 ? "" : "s"}`,
            title: "Where these themes come up together",
            parts: picked.map((t) => ({ themeId: t.id, transcriptIds: shared })),
          }
        : { kicker: picked[0].ref, title: picked[0].title, parts: [{ themeId: picked[0].id }] },
    );
  if (!picked.length) return null;
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
        maxWidth: "min(760px, calc(100vw - 32px))",
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
      <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--color-navy-muted)", fontWeight: 700, flex: "none" }}>SELECTED</span>
      <span style={{ display: "flex", gap: 10, minWidth: 0 }}>
        {picked.map((t, i) => (
          <span key={t.id} style={{ display: "flex", gap: 6, minWidth: 0, alignItems: "baseline" }}>
            {i > 0 && <span style={{ color: "var(--color-navy-muted)" }}>+</span>}
            <span className="mono" style={{ fontSize: 11, color: "var(--color-accent-200)", flex: "none" }}>
              {t.ref}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: pair ? 180 : 380 }}>{t.title}</span>
          </span>
        ))}
      </span>
      <button className="btn" onClick={view} style={{ fontSize: 11.5, padding: "3px 12px", color: "var(--color-navy)", background: "#FFFFFF", borderColor: "#FFFFFF", borderRadius: "var(--radius-pill)", flex: "none" }}>
        View quotes
      </button>
      <button
        className="btn"
        onClick={() => select([])}
        aria-label="Clear selection"
        style={{ fontSize: 11.5, padding: "3px 10px", color: "#FFFFFF", borderColor: "rgba(255,255,255,0.35)", borderRadius: "var(--radius-pill)", flex: "none" }}
      >
        Clear
      </button>
    </div>
  );
}

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** The quotes behind whatever was clicked, grouped by theme and interview,
 *  each linking to its line in the transcript. Escape or ✕ closes it. */
function QuotePanel({ spec, onClose }: { spec: PanelSpec; onClose: () => void }) {
  const { themes, interviews, quotes } = useCorpus();

  const parts = spec.parts.map((p) => {
    const only = p.transcriptIds && new Set(p.transcriptIds);
    const types = p.types && new Set(p.types);
    const list = (quotes[p.themeId] ?? []).filter((q) => (!only || only.has(q.transcriptId)) && (!types || types.has(q.type)));
    const byInterview = new Map<string, CorpusQuote[]>();
    for (const q of list) (byInterview.get(q.transcriptId) ?? byInterview.set(q.transcriptId, []).get(q.transcriptId)!).push(q);
    return { theme: themes.get(p.themeId)!, byInterview: [...byInterview], count: list.length };
  });
  const total = parts.reduce((a, p) => a + p.count, 0);
  const ivs = new Set(parts.flatMap((p) => p.byInterview.map(([id]) => id))).size;

  return (
    <aside
      role="dialog"
      aria-label={spec.title}
      className="panel"
      style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)", zIndex: 60, borderRadius: 0, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", background: "var(--color-surface)" }}
    >
      <header style={{ background: "var(--color-navy)", color: "#FFFFFF", padding: "var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--color-navy-muted)" }}>
            {spec.kicker.toUpperCase()}
          </span>
          <h3 style={{ fontSize: 16, margin: "3px 0 2px", color: "#FFFFFF", lineHeight: 1.3 }}>{spec.title}</h3>
          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)" }}>
            {total} code{total === 1 ? "" : "s"} from {ivs} interview{ivs === 1 ? "" : "s"}
          </span>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close" style={{ color: "#FFFFFF", borderColor: "rgba(255,255,255,0.35)", padding: "2px 9px", fontSize: 13 }}>
          ✕
        </button>
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5, 20px)" }}>
        {parts.map(({ theme, byInterview }) => (
          <section key={theme.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {parts.length > 1 && (
              <div style={{ display: "flex", gap: 6, alignItems: "baseline", paddingBottom: 4, borderBottom: "2px solid var(--color-navy)" }}>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--color-accent-700)" }}>
                  {theme.ref}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)" }}>{theme.title}</span>
              </div>
            )}
            {!byInterview.length && <span className="meta">No codes.</span>}
            {byInterview.map(([id, qs]) => {
              const iv = interviews.get(id);
              return (
                <div key={id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  <Link href={`/transcripts/${id}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--color-navy)", textDecoration: "none", borderBottom: "1px solid var(--color-divider)", paddingBottom: 4 }}>
                    <span className="mono" style={{ color: "var(--color-accent-700)", marginRight: 6 }}>
                      {iv?.key}
                    </span>
                    {iv?.participant ?? iv?.title}
                  </Link>
                  {qs.map((q) => (
                    <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="mono" style={{ fontSize: 9.5, padding: "1px 5px", background: "var(--color-accent-200)", color: "var(--color-navy)", flex: "none" }}>
                          {q.ref}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{q.label}</span>
                        <Link href={`/transcripts/${id}#L${q.start}`} className="mono" style={{ fontSize: 10, marginLeft: "auto", color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>
                          L{q.start}
                          {q.end > q.start ? `–${q.end}` : ""} →
                        </Link>
                      </div>
                      <blockquote style={{ margin: 0, padding: "4px 0 4px 10px", borderLeft: "2px solid var(--color-accent-300)", fontSize: 12.5, lineHeight: 1.5, color: muted(80) }}>
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
