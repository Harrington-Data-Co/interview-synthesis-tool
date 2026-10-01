"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { reach, type Edge } from "@/lib/corpus/chain";
import { projectHref } from "@/lib/urls";

type Line =
  | { kind: "gap"; from: number; to: number }
  | { kind: "line"; n: number; speaker: string; participant: boolean; text: string; coded: boolean };

export type ChainData = {
  interview: { id: string; key: string; title: string; participant: string | null; lineCount: number };
  interviews: { id: string; label: string }[];
  notes: { id: string; name: string }[];
  noteTemplateId: string | null;
  memos: { id: string; name: string }[];
  memoTemplateId: string | null;
  lines: Line[];
  codes: { id: string; ref: string; type: string; label: string; start: number; end: number }[];
  noteSections: { id: string; name: string; items: { id: string; text: string; codeIds: string[] }[] }[];
  themes: { id: string; ref: string; title: string; proposed: boolean; codeIds: string[] }[];
  memoSections: { id: string; name: string; paragraphs: { id: string; text: string; themeIds: string[]; codeIds: string[] }[] }[];
  hiddenParagraphs: number;
  edges: Edge[];
};

/** An edge as drawn. An end whose card is scrolled out of its column is
 *  pinned to the column's top or bottom edge, and the edge is dashed. */
type Path = { a: string; b: string; d: string; offscreen: boolean };
type Density = "fit" | "spread";

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
const addr = (s: number, e: number) => `L${s}${e > s ? `–${e}` : ""}`;
const STAGES = ["Transcript", "Codes", "Note", "Themes", "Memo"];
const DENSITY_KEY = "chain-density";

// Transcript, codes, note, themes, memo. Fit shares the board's width, down to
// minimums below which the board scrolls; Spread gives each column room to
// read and lets the board scroll sideways.
const LAYOUT = {
  fit: { widths: [260, 200, 240, 200, 260], grow: [1.25, 1, 1.15, 1, 1.25], gap: 44 },
  spread: { widths: [500, 340, 460, 340, 480], grow: null, gap: 88 },
} as const;
const columnsFor = (d: Density) => {
  const l = LAYOUT[d];
  return l.widths.map((w, i) => (l.grow ? `minmax(${w}px,${l.grow[i]}fr)` : `${w}px`)).join(" ");
};
const minWidthFor = (d: Density) => LAYOUT[d].widths.reduce((a, b) => a + b, 0) + 4 * LAYOUT[d].gap + 32;

// The layout choice is a per-viewer convenience kept in this browser. Storage
// can be unavailable (private windows, blocked site data); then it lasts for
// the visit only.
let remembered: Density = "fit";
const listeners = new Set<() => void>();
const readDensity = (): Density => {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    if (v === "fit" || v === "spread") return v;
  } catch {}
  return remembered;
};
const writeDensity = (d: Density) => {
  remembered = d;
  try {
    localStorage.setItem(DENSITY_KEY, d);
  } catch {}
  listeners.forEach((l) => l());
};
const watchDensity = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** An edge that skips a column (code → theme passes the note; code →
 *  paragraph passes the note and themes). Drawn behind the cards so it
 *  doesn't cross their text; edges between neighbours are drawn over them. */
const skips = (e: { a: string; b: string }) => e.a.startsWith("cd-") && (e.b.startsWith("th-") || e.b.startsWith("pa-"));

/** One interview's provenance on one board: transcript → codes → note, and
 *  codes → themes → memo. Each column scrolls on its own and the edges
 *  follow. Click any node to light only what it derives from and what
 *  derives from it; the other columns scroll to bring that chain into view. */
export function ChainBoard({ projectPath, withProposed, data }: { projectPath: string; withProposed: boolean; data: ChainData }) {
  const router = useRouter();
  const board = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLElement | null)[]>([]);
  const bodies = useRef<(HTMLDivElement | null)[]>([]);
  const frame = useRef(0);
  const [node, setNode] = useState<string | null>(null);
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [full, setFull] = useState(false);
  const density = useSyncExternalStore(watchDensity, readDensity, () => "fit" as Density);
  const [side, setSide] = useState({ left: false, right: false, visible: [true, true, true, true, true] });

  const lit = useMemo(() => (node ? reach(data.edges, node) : null), [node, data.edges]);
  const layout = LAYOUT[density];

  const measure = useCallback(() => {
    const root = content.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const place = new Map<string, { rect: DOMRect; top: number; bottom: number }>();
    bodies.current.forEach((body) => {
      if (!body) return;
      const b = body.getBoundingClientRect();
      body.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => place.set(el.dataset.node!, { rect: el.getBoundingClientRect(), top: b.top, bottom: b.bottom }));
    });
    // A node's vertical middle, pinned inside its column's visible body.
    const anchor = (p: { rect: DOMRect; top: number; bottom: number }) => {
      const mid = p.rect.top + p.rect.height / 2;
      const y = Math.min(Math.max(mid, p.top + 3), p.bottom - 3);
      return { y: y - origin.top, pinned: y !== mid };
    };
    const bend = layout.gap;
    const next: Path[] = [];
    for (const e of data.edges) {
      const A = place.get(e.a);
      const B = place.get(e.b);
      if (!A || !B) continue;
      const a = anchor(A);
      const b = anchor(B);
      const x1 = A.rect.right - origin.left;
      const x2 = B.rect.left - origin.left;
      const k = Math.min(bend, (x2 - x1) / 2);
      next.push({
        a: e.a,
        b: e.b,
        offscreen: a.pinned || b.pinned,
        d: `M${x1.toFixed(1)},${a.y.toFixed(1)} C${(x1 + k).toFixed(1)},${a.y.toFixed(1)} ${(x2 - k).toFixed(1)},${b.y.toFixed(1)} ${x2.toFixed(1)},${b.y.toFixed(1)}`,
      });
    }
    setPaths(next);
    setSize({ w: root.scrollWidth, h: root.scrollHeight });
  }, [data.edges, layout.gap]);

  // Which way the board can scroll, and which columns are mostly in view.
  const survey = useCallback(() => {
    const el = board.current;
    if (!el) return;
    const left = el.scrollLeft;
    const right = left + el.clientWidth;
    setSide({
      left: left > 4,
      right: right < el.scrollWidth - 4,
      visible: cols.current.map((c) => {
        if (!c) return false;
        const seen = Math.min(right, c.offsetLeft + c.offsetWidth) - Math.max(left, c.offsetLeft);
        return seen >= c.offsetWidth * 0.5;
      }),
    });
  }, []);

  const soon = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  useLayoutEffect(() => {
    measure();
    survey();
    const root = content.current;
    const el = board.current;
    if (!root || !el) return;
    const watch = new ResizeObserver(() => {
      measure();
      survey();
    });
    watch.observe(root);
    watch.observe(el);
    const scrollers = bodies.current.filter((b): b is HTMLDivElement => !!b);
    scrollers.forEach((b) => b.addEventListener("scroll", soon, { passive: true }));
    el.addEventListener("scroll", survey, { passive: true });
    document.fonts?.ready.then(measure);
    return () => {
      watch.disconnect();
      scrollers.forEach((b) => b.removeEventListener("scroll", soon));
      el.removeEventListener("scroll", survey);
      cancelAnimationFrame(frame.current);
    };
  }, [measure, survey, soon, density]);

  // Full screen: Escape leaves it, and the page behind doesn't scroll.
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
    };
  }, [full]);

  // Bring the picked chain into view in every other column: centred when it
  // fits, else its first card near the top.
  useEffect(() => {
    if (!node || !lit) return;
    for (const body of bodies.current) {
      if (!body || body.querySelector(`[data-node="${node}"]`)) continue;
      const hits = [...body.querySelectorAll<HTMLElement>("[data-node]")].filter((el) => lit.has(el.dataset.node!));
      if (!hits.length) continue;
      const base = body.getBoundingClientRect().top - body.scrollTop;
      const top = hits[0].getBoundingClientRect().top - base;
      const bottom = hits[hits.length - 1].getBoundingClientRect().bottom - base;
      const room = body.clientHeight;
      const target = bottom - top <= room - 48 ? top - (room - (bottom - top)) / 2 : top - 24;
      body.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  }, [node, lit]);

  const go = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams({ interview: data.interview.id });
    if (data.noteTemplateId) q.set("note", data.noteTemplateId);
    if (data.memoTemplateId) q.set("memo", data.memoTemplateId);
    if (withProposed) q.set("proposed", "1");
    for (const [k, v] of Object.entries(changes)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setNode(null);
    router.push(projectHref(projectPath, "chain", Object.fromEntries(q)), { scroll: false });
  };

  const jump = (i: number) => {
    const c = cols.current[i];
    if (c) board.current?.scrollTo({ left: Math.max(0, c.offsetLeft - 16), behavior: "smooth" });
  };
  const nudge = (dir: 1 | -1) => {
    const el = board.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: "smooth" });
  };

  const pick = (id: string) => setNode((cur) => (cur === id ? null : id));
  const on = (id: string) => !lit || lit.has(id);
  const nodeStyle = (id: string) => ({
    opacity: on(id) ? 1 : 0.28,
    cursor: "pointer",
    background: node === id ? "var(--color-accent-200)" : lit && lit.has(id) ? "var(--color-accent-100)" : "var(--color-surface)",
  });
  const cardBorder = (id: string) =>
    node === id ? "var(--color-accent-700)" : lit && lit.has(id) ? "var(--color-accent-400)" : "var(--line-4)";
  const chip = (id: string) => ({
    background: node === id ? "var(--color-accent-700)" : "var(--color-accent-200)",
    color: node === id ? "var(--color-bg)" : "var(--color-navy)",
  });
  const keys = (id: string) => ({
    tabIndex: 0,
    role: "button" as const,
    "aria-pressed": node === id,
    "data-node": id,
    onClick: () => pick(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick(id);
      }
    },
  });

  let readout = "No selection · showing every derivation";
  if (lit) {
    const code = node?.startsWith("cd-") ? data.codes.find((c) => `cd-${c.id}` === node) : null;
    readout = `${lit.size - 1} connected${code ? ` · ${code.ref}` : ""}`;
  }

  const paragraphCount = data.memoSections.reduce((a, s) => a + s.paragraphs.length, 0);
  const itemCount = data.noteSections.reduce((a, s) => a + s.items.length, 0);
  const scrolls = side.left || side.right;

  const edgeLayer = (behind: boolean) => (
    <svg
      aria-hidden
      style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h, pointerEvents: "none", zIndex: behind ? -1 : 2, overflow: "visible" }}
    >
      {paths
        .filter((p) => skips(p) === behind)
        .map((p) => {
          const hot = !!lit && lit.has(p.a) && lit.has(p.b);
          return (
            <path
              key={`${p.a}>${p.b}`}
              d={p.d}
              style={{
                fill: "none",
                stroke: hot ? "var(--color-accent-700)" : "var(--color-accent-400)",
                strokeWidth: hot ? 1.8 : 0.8,
                strokeDasharray: p.offscreen ? "4 3" : undefined,
                opacity: lit ? (hot ? (p.offscreen ? 0.7 : 1) : 0.06) : p.offscreen ? 0.18 : behind ? 0.3 : 0.45,
              }}
            />
          );
        })}
    </svg>
  );

  /** One stage of the chain: a card with a navy header band over a body
   *  that scrolls on its own. */
  const column = (i: number, step: string, title: string, sub: string, count: number | null, body: React.ReactNode) => (
    <section
      ref={(el) => {
        cols.current[i] = el;
      }}
      className="panel"
      style={{ minWidth: 0, minHeight: 0, padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <header
        style={{
          background: "var(--color-navy)",
          color: "#FFFFFF",
          padding: "var(--space-3) var(--space-4)",
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-3)",
          flex: "none",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--color-navy-muted)" }}>
            {step}
          </span>
          <h3 style={{ fontSize: 17, margin: "1px 0 2px", color: "#FFFFFF" }}>{title}</h3>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub}>
            {sub}
          </span>
        </div>
        {count !== null && (
          <span className="mono" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "rgba(255,255,255,0.14)", color: "#FFFFFF", flex: "none" }}>
            {count}
          </span>
        )}
      </header>
      <div
        ref={(el) => {
          bodies.current[i] = el;
        }}
        data-col-body
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: 6 }}
      >
        {body}
      </div>
    </section>
  );
  const empty = (text: string) => (
    <p className="meta" style={{ margin: "var(--space-1) 0", fontSize: 12 }}>
      {text}
    </p>
  );
  const sectionTitle = (name: string) => (
    <span
      style={{
        fontFamily: "var(--font-heading)",
        fontWeight: 700,
        fontSize: 10.5,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--color-accent-700)",
        padding: "var(--space-2) 2px 2px",
        borderBottom: "1px solid var(--color-divider)",
      }}
    >
      {name}
    </span>
  );

  const picker = (label: string, value: string, options: { id: string; name: string }[], onChange: (v: string) => void, maxWidth?: number) => (
    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span className="kicker" style={{ fontSize: 9.5 }}>
        {label}
      </span>
      <select className="input" style={{ width: "auto", maxWidth }} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  const arrow = (dir: 1 | -1) => (
    <button
      className="btn btn-secondary"
      onClick={() => nudge(dir)}
      aria-label={dir > 0 ? "Scroll right" : "Scroll left"}
      style={{
        position: "absolute",
        top: "50%",
        [dir > 0 ? "right" : "left"]: 10,
        transform: "translateY(-50%)",
        zIndex: 5,
        width: 36,
        height: 36,
        padding: 0,
        borderRadius: "50%",
        boxShadow: "var(--shadow-md)",
        fontSize: 16,
      }}
    >
      {dir > 0 ? "→" : "←"}
    </button>
  );
  const fade = (dir: 1 | -1) => (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [dir > 0 ? "right" : "left"]: 0,
        width: 56,
        zIndex: 4,
        pointerEvents: "none",
        background: `linear-gradient(to ${dir > 0 ? "left" : "right"}, var(--color-neutral-100), transparent)`,
      }}
    />
  );

  return (
    <div
      style={
        full
          ? { position: "fixed", inset: 0, zIndex: 100, background: "var(--color-bg)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }
          : { display: "flex", flexDirection: "column", gap: "var(--space-3)" }
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }}>
        {picker(
          "Interview",
          data.interview.id,
          data.interviews.map((i) => ({ id: i.id, name: i.label })),
          (v) => go({ interview: v, note: null }),
          320,
        )}
        {data.notes.length > 1 && picker("Note", data.noteTemplateId ?? "", data.notes, (v) => go({ note: v }))}
        {data.memos.length > 1 && picker("Memo", data.memoTemplateId ?? "", data.memos, (v) => go({ memo: v }))}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={withProposed} onChange={(e) => go({ proposed: e.target.checked ? "1" : null })} />
          Include proposed themes
        </label>
        <div style={{ display: "flex", gap: "var(--space-2)", marginLeft: "auto", alignItems: "center", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-accent-700)" }} aria-live="polite">
            {readout}
          </span>
          <button className="btn btn-secondary" style={{ fontSize: 11.5 }} onClick={() => setNode(null)} disabled={!node}>
            Clear
          </button>
          <div className="seg" role="radiogroup" aria-label="Layout">
            {(["fit", "spread"] as const).map((d) => (
              <label key={d} className="seg-opt" title={d === "fit" ? "Fit every stage on screen" : "Give each stage room; scroll sideways"}>
                <input
                  type="radio"
                  name="chain-density"
                  checked={density === d}
                  onChange={() => writeDensity(d)}
                  style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                <span style={{ fontSize: 11.5 }}>{d === "fit" ? "Fit" : "Spread"}</span>
              </label>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 11.5 }} onClick={() => setFull((f) => !f)} aria-pressed={full}>
            {full ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {scrolls && (
        <nav aria-label="Stages" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="kicker" style={{ fontSize: 9.5, marginRight: 2 }}>
            Stages
          </span>
          {STAGES.map((name, i) => (
            <button
              key={name}
              onClick={() => jump(i)}
              className="btn"
              aria-current={side.visible[i] ? "true" : undefined}
              style={{
                fontSize: 11.5,
                padding: "3px 10px",
                borderRadius: "var(--radius-pill)",
                background: side.visible[i] ? "var(--color-navy)" : "var(--color-surface)",
                color: side.visible[i] ? "#FFFFFF" : "var(--color-navy)",
                borderColor: side.visible[i] ? "var(--color-navy)" : "var(--line-4)",
              }}
            >
              {name}
            </button>
          ))}
          <span className="meta" style={{ fontSize: 11.5, marginLeft: 4 }}>
            {side.left && side.right ? "← More on both sides →" : side.right ? "More to the right →" : "← More to the left"}
          </span>
        </nav>
      )}

      <div style={{ position: "relative", ...(full ? { flex: 1, minHeight: 0, display: "flex" } : {}) }}>
        {side.left && fade(-1)}
        {side.right && fade(1)}
        {side.left && arrow(-1)}
        {side.right && arrow(1)}
        <div
          ref={board}
          style={{
            overflowX: "auto",
            overflowY: "hidden",
            position: "relative",
            background: "var(--color-neutral-100)",
            border: "1px solid var(--line-2)",
            borderRadius: "var(--radius)",
            ...(full ? { flex: 1, minHeight: 0 } : { height: "calc(100vh - 240px)", minHeight: 520 }),
          }}
        >
          <div
            ref={content}
            style={{
              position: "relative",
              zIndex: 0,
              display: "grid",
              gridTemplateColumns: columnsFor(density),
              gridTemplateRows: "minmax(0, 1fr)",
              columnGap: layout.gap,
              height: "100%",
              padding: "var(--space-4)",
              boxSizing: "border-box",
              ...(density === "fit" ? { width: "100%", minWidth: minWidthFor("fit") } : { width: minWidthFor("spread") }),
            }}
          >
            {edgeLayer(true)}
            {edgeLayer(false)}

            {column(
              0,
              "01 · RAW",
              "Transcript",
              `${data.interview.key} · ${data.interview.participant ?? data.interview.title} · ${data.interview.lineCount} lines`,
              null,
              <>
                {data.lines.map((l) =>
                  l.kind === "gap" ? (
                    <span key={`g${l.from}`} className="mono" style={{ fontSize: 10, color: muted(38), padding: "2px 8px 2px 42px" }}>
                      ⋯ {l.from === l.to ? `line ${l.from}` : `lines ${l.from}–${l.to}`}
                    </span>
                  ) : (
                    <div
                      key={l.n}
                      {...(l.coded ? keys(`ln-${l.n}`) : {})}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "26px 1fr",
                        gap: "var(--space-3)",
                        padding: "5px 8px",
                        ...(l.coded
                          ? { ...nodeStyle(`ln-${l.n}`), boxShadow: `inset 2px 0 0 ${node === `ln-${l.n}` ? "var(--color-accent-700)" : "var(--color-accent-300)"}` }
                          : { opacity: lit ? 0.2 : 0.55 }),
                      }}
                    >
                      <span className="mono" style={{ fontSize: 9.5, lineHeight: 1.7, textAlign: "right", color: muted(38) }}>
                        {l.n}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: "var(--font-heading)",
                            fontWeight: 700,
                            fontSize: 10.5,
                            letterSpacing: "0.06em",
                            display: "block",
                            color: l.participant ? "var(--color-accent-700)" : muted(42),
                          }}
                        >
                          {l.speaker}
                        </span>
                        <span style={{ fontSize: 12, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {l.text}
                        </span>
                      </div>
                    </div>
                  ),
                )}
                <Link href={`/transcripts/${data.interview.id}`} className="meta" style={{ fontSize: 12, marginTop: "var(--space-2)" }}>
                  Open the full transcript →
                </Link>
              </>,
            )}

            {column(
              1,
              "02 · CODED",
              "Codes",
              "From this interview",
              data.codes.length,
              data.codes.map((c) => {
                const id = `cd-${c.id}`;
                return (
                  <div key={c.id} {...keys(id)} className="panel" style={{ padding: "7px 9px", display: "flex", flexDirection: "column", gap: 3, boxShadow: "none", flex: "none", ...nodeStyle(id), borderColor: cardBorder(id) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontSize: 9.5, padding: "1px 5px", ...chip(id) }}>
                        {c.ref}
                      </span>
                      <span className="mono" style={{ fontSize: 9.5, marginLeft: "auto", color: "var(--color-accent-700)" }}>
                        {addr(c.start, c.end)}
                      </span>
                    </div>
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{c.label}</span>
                  </div>
                );
              }),
            )}

            {column(
              2,
              "03 · ARTIFACT",
              "Interview note",
              data.notes.length ? (data.notes.find((n) => n.id === data.noteTemplateId)?.name ?? "") : "No note yet",
              data.notes.length ? itemCount : null,
              <>
                {!data.notes.length && empty("This interview has no note yet. Generate one from the interview's Notes tab.")}
                {data.noteSections.map((s) => (
                  <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 4, flex: "none" }}>
                    {sectionTitle(s.name)}
                    {!s.items.length && <span style={{ fontSize: 11.5, color: muted(40), padding: "2px 9px" }}>Nothing in this section.</span>}
                    {s.items.map((it) => {
                      const id = `it-${it.id}`;
                      return (
                        <div
                          key={it.id}
                          {...keys(id)}
                          style={{
                            padding: "6px 9px",
                            fontSize: 12.5,
                            lineHeight: 1.45,
                            ...nodeStyle(id),
                            boxShadow: `inset 2px 0 0 ${lit?.has(id) ? "var(--color-accent-400)" : "transparent"}`,
                          }}
                        >
                          {it.text}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>,
            )}

            {column(
              3,
              "04a · SYNTHESIS",
              "Themes",
              withProposed ? "Confirmed and proposed" : "Confirmed only",
              data.themes.length,
              <>
                {!data.themes.length &&
                  empty(withProposed ? "No theme holds a code from this interview." : "No confirmed theme holds a code from this interview.")}
                {data.themes.map((t) => {
                  const id = `th-${t.id}`;
                  return (
                    <div key={t.id} {...keys(id)} className="panel" style={{ padding: "9px 11px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "none", flex: "none", ...nodeStyle(id), borderColor: cardBorder(id) }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="mono" style={{ fontSize: 9.5, padding: "1px 5px", ...chip(id) }}>
                          {t.ref}
                        </span>
                        {t.proposed && (
                          <span className="tag tag-outline" style={{ fontSize: 9 }}>
                            proposed
                          </span>
                        )}
                        <span className="mono" style={{ fontSize: 9.5, marginLeft: "auto", color: muted(55) }}>
                          {t.codeIds.length} here
                        </span>
                      </div>
                      <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>{t.title}</span>
                    </div>
                  );
                })}
              </>,
            )}

            {column(
              4,
              "04b · PRODUCT",
              "Memo",
              data.memos.length ? (data.memos.find((m) => m.id === data.memoTemplateId)?.name ?? "") : "No memo yet",
              data.memos.length ? paragraphCount : null,
              <>
                {!data.memos.length && empty("This project has no memo yet. Write one on the Memo tab.")}
                {data.memoSections
                  .filter((s) => s.paragraphs.length)
                  .map((s) => (
                    <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 4, flex: "none" }}>
                      {sectionTitle(s.name)}
                      {s.paragraphs.map((p) => {
                        const id = `pa-${p.id}`;
                        return (
                          <div
                            key={p.id}
                            {...keys(id)}
                            className="panel"
                            style={{ padding: "8px 10px", fontSize: 12.5, lineHeight: 1.5, boxShadow: "none", ...nodeStyle(id), borderColor: cardBorder(id) }}
                          >
                            <span style={{ display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                {data.memos.length > 0 && !paragraphCount && empty("No paragraph of this memo cites this interview's codes or its themes.")}
                {data.hiddenParagraphs > 0 && (
                  <span style={{ fontSize: 11.5, color: muted(50) }}>
                    {data.hiddenParagraphs} other paragraph{data.hiddenParagraphs === 1 ? "" : "s"} cite nothing from this interview.
                  </span>
                )}
                {data.memos.length > 0 && (
                  <Link
                    href={projectHref(projectPath, "memo", { template: data.memoTemplateId })}
                    className="meta"
                    style={{ fontSize: 12, marginTop: "var(--space-2)" }}
                  >
                    Open the memo →
                  </Link>
                )}
              </>,
            )}
          </div>
        </div>
      </div>
      {!full && (
        <p className="meta" style={{ margin: 0, fontSize: 11.5 }}>
          Each column scrolls on its own. A dashed edge leads to a card scrolled out of its column. Theme edges come from
          codes, not the note, so they run behind the note column.
        </p>
      )}
    </div>
  );
}
