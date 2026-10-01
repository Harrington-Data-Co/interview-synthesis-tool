"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EvidenceDrawer, type DrawerSection } from "@/components/evidence/EvidenceDrawer";
import { SelectionBar as Pill, pillButton, useClickOff } from "@/components/SelectionBar";

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
  projectPath: string;
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

// Shared with other selections (the People table): see SelectionBar.
export { KEEP } from "@/components/SelectionBar";

/** The corpus views' shared data (themes, interviews, each theme's quotes),
 *  the selection they share, and the one quotes panel every chart opens.
 *  Escape closes the panel, or clears the selection when no panel is open;
 *  a click on nothing in particular clears the selection too. */
export function CorpusProvider({
  projectPath,
  themes,
  interviews,
  quotes,
  children,
}: {
  projectPath: string;
  themes: CorpusThemeInfo[];
  interviews: CorpusInterviewInfo[];
  quotes: Record<string, CorpusQuote[]>;
  children: React.ReactNode;
}) {
  const [panel, setPanel] = useState<PanelSpec | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const value = useMemo<Corpus>(
    () => ({
      projectPath,
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
    [projectPath, themes, interviews, quotes, panel, selected],
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
  const clearSelection = useCallback(() => setSelected([]), []);
  useClickOff(selected.length > 0, clearSelection);
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
    <Pill>
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
      <button className="btn" onClick={view} style={pillButton(true)}>
        View quotes
      </button>
      <button className="btn" onClick={() => select([])} aria-label="Clear selection" style={{ ...pillButton(false), padding: "3px 10px" }}>
        Clear
      </button>
    </Pill>
  );
}

/** The quotes behind whatever was clicked, grouped by theme and interview.
 *  Escape or ✕ closes it. */
function QuotePanel({ spec, onClose }: { spec: PanelSpec; onClose: () => void }) {
  const { themes, interviews, quotes } = useCorpus();
  const sections: DrawerSection[] = spec.parts.map((p) => {
    const only = p.transcriptIds && new Set(p.transcriptIds);
    const types = p.types && new Set(p.types);
    const theme = themes.get(p.themeId)!;
    return {
      key: p.themeId,
      heading: { ref: theme.ref, title: theme.title },
      quotes: (quotes[p.themeId] ?? []).filter((q) => (!only || only.has(q.transcriptId)) && (!types || types.has(q.type))),
    };
  });
  return <EvidenceDrawer kicker={spec.kicker} title={spec.title} sections={sections} interviews={interviews} onClose={onClose} />;
}
