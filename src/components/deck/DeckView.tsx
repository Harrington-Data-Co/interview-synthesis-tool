"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { templateAction } from "@/components/templates/TemplatesEditor";
import { Notice } from "@/components/ui";
import { attribution, evidenceLine } from "@/lib/deck/evidence";
import type { LoadedDeck, SlideView } from "@/lib/deck/load";
import { deckAction } from "./actions";
import { SlideEditor, type SlideSeed } from "./SlideEditor";
import { SlideFrame } from "./SlideFrame";

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** Deliverable: the slide deck. Written from a deck template and the
 *  project's confirmed themes; every slide cites what it rests on and a
 *  quote is always the participant's exact words. Downloads as .pptx. */
export function DeckView({ projectId, editor, deck, roles }: { projectId: string; editor: boolean; deck: LoadedDeck; roles: Record<string, string> }) {
  const { templates, library, template, product, slides, themes, interviews, codes, rejections, runs } = deck;
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ title: string; seed: SlideSeed } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [libraryPick, setLibraryPick] = useState(library[0]?.id ?? "");
  const [title, setTitle] = useState<string | null>(null);

  const codeOf = new Map(codes.map((c) => [c.id, c]));
  const themeOf = new Map(themes.map((t) => [t.id, t]));
  const sectionName = new Map((template?.sections ?? []).map((s) => [s.id, s.name]));
  const stageHref = (tid: string) => `/projects/${projectId}?view=deck&template=${tid}`;
  const confirmed = themes.filter((t) => t.status === "confirmed");
  const cited = new Set(slides.flatMap((s) => s.themeIds));
  const leftOut = confirmed.filter((t) => !cited.has(t.id));
  const claudeSlides = slides.filter((s) => s.origin === "claude").length;
  const chosen = slides.find((s) => s.id === open) ?? null;
  const lastRun = runs[0];
  const small = { fontSize: 11.5, padding: "2px 8px" } as const;

  const quoteOf = (s: SlideView) => (s.quoteCodeId ? codeOf.get(s.quoteCodeId) : undefined);
  const frame = (s: SlideView, i: number) => {
    const q = quoteOf(s);
    return (
      <SlideFrame
        slide={s}
        kicker={sectionName.get(s.sectionId) ?? ""}
        quote={q?.verbatim}
        who={q ? attribution(roles[q.id]) : undefined}
        evidence={evidenceLine(s, deck)}
        number={i + 2}
      />
    );
  };

  async function act(body: Record<string, unknown>, done?: string) {
    if (!product) return;
    setBusy(true);
    setNotice(null);
    const { error } = await deckAction(product.id, body);
    setBusy(false);
    setConfirming(null);
    if (error) return setNotice({ tone: "error", text: error });
    if (done) setNotice({ tone: "info", text: done });
    router.refresh();
  }

  async function write(replace: boolean) {
    if (!template) return;
    setRunning(true);
    setNotice(null);
    setConfirming(null);
    const res = await fetch(`/api/projects/${projectId}/deck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: template.id, replace }),
    });
    const b = await res.json().catch(() => ({}));
    setRunning(false);
    if (res.status === 409 && !replace) {
      setConfirming("rewrite");
      return setNotice({ tone: "info", text: b.error });
    }
    if (!res.ok) setNotice({ tone: "error", text: b.error ?? `Writing the deck failed (${res.status}).` });
    else {
      const cost = typeof b.costUsd === "number" ? ` · $${b.costUsd.toFixed(2)}` : "";
      setNotice({ tone: "info", text: `Deck written: ${b.accepted} slides${b.rejected ? `, ${b.rejected} waiting in Needs review` : ""}${cost}.` });
    }
    router.refresh();
  }

  async function addTemplate() {
    setBusy(true);
    const { error, id } = await templateAction({ kind: "deck", action: "addToProject", templateId: libraryPick, projectId });
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: error });
    router.push(stageHref(id!));
    router.refresh();
  }

  if (!template) {
    return (
      <div className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p className="meta" style={{ margin: 0 }}>This project has no deck templates yet.</p>
        {editor && library.length > 0 && (
          <div style={{ display: "flex", gap: 6 }}>
            <select className="input" value={libraryPick} onChange={(e) => setLibraryPick(e.target.value)} style={{ width: "auto" }}>
              {library.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={busy || !libraryPick} onClick={addTemplate}>
              Add to this project
            </button>
          </div>
        )}
        {editor && !library.length && (
          <p className="meta" style={{ margin: 0 }}>
            The deck template library is empty. <Link href="/templates?kind=deck">Set one up on the Templates page</Link> (there&apos;s a
            ready-made “Findings readout” to start from).
          </p>
        )}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>
    );
  }

  const openEditor = (t: string, s: SlideSeed) => setSeed({ title: t, seed: s });
  const firstSection = template.sections[0]?.id ?? "";
  const blank = (sectionId: string): SlideSeed => ({ sectionId, layout: "finding", title: "", bullets: [], quoteCodeId: null, notes: "", themeIds: [], codeIds: [] });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        {templates.map((t) => (
          <Link
            key={t.id}
            href={stageHref(t.id)}
            className="btn"
            style={{
              fontSize: 12.5,
              background: t.id === template.id ? "var(--color-accent-tint)" : "transparent",
              color: t.id === template.id ? "var(--color-accent-800)" : "var(--color-text)",
              fontWeight: t.id === template.id ? 700 : 500,
            }}
          >
            {t.name}
          </Link>
        ))}
        <Link href={`/templates?kind=deck&t=${template.id}`} className="meta" style={{ fontSize: 12 }}>
          Edit template
        </Link>
        <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
          {product && slides.length > 0 && (
            <a className="btn btn-secondary" href={`/api/projects/${projectId}/deck/pptx?template=${template.id}`}>
              Download .pptx
            </a>
          )}
          {editor && (
            <button className="btn btn-primary" disabled={running || busy} onClick={() => (confirming === "rewrite" ? write(true) : write(false))}>
              {running ? "Writing…" : confirming === "rewrite" ? "Rewrite, keeping edited slides" : claudeSlides ? "Rewrite" : "Write"}
            </button>
          )}
        </span>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {lastRun && (
        <span className="meta" style={{ fontSize: 11.5 }}>
          Last written by {lastRun.started_by} · {new Date(lastRun.started_at).toLocaleString()} ·{" "}
          {lastRun.status === "failed"
            ? `failed: ${lastRun.error}`
            : lastRun.status === "running"
              ? "still running"
              : `${lastRun.accepted} slides kept, ${lastRun.rejected} for review · ${lastRun.cost_usd === null ? "cost unknown" : `$${Number(lastRun.cost_usd).toFixed(2)}`}`}
        </span>
      )}

      {!product ? (
        <div className="panel" style={{ padding: "var(--space-6)" }}>
          <p className="meta" style={{ margin: 0 }}>
            No deck yet. {editor ? `Write it with Claude from the ${confirmed.length} confirmed themes, one section at a time as the template sets out.` : ""}
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {title === null ? (
              <h3 style={{ fontSize: 20, margin: 0, cursor: editor ? "text" : undefined }} onClick={() => editor && setTitle(product.title ?? "")}>
                {product.title ?? "Untitled deck"}
              </h3>
            ) : (
              <input
                className="input"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={async () => {
                  if (title.trim() !== (product.title ?? "")) await act({ action: "title", title: title.trim() });
                  setTitle(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                style={{ fontSize: 18, fontWeight: 700 }}
                aria-label="Deck title"
              />
            )}
            <span className="meta" style={{ fontSize: 12 }}>
              {slides.length + 1} slides with the title slide
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-4)" }}>
            <div>
              <SlideFrame slide={null} kicker={`${template.name}${deck.project.client ? ` · ${deck.project.client}` : ""}`} titleSlide={{ title: product.title ?? template.name, sub: `${deck.project.name} · ${interviews.length} interviews` }} />
              <span className="meta" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                1 · Title
              </span>
            </div>
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setOpen((cur) => (cur === s.id ? null : s.id))}
                aria-pressed={open === s.id}
                style={{ all: "unset", cursor: "pointer", display: "block", outline: open === s.id ? "3px solid var(--color-accent-400)" : undefined, outlineOffset: 3, borderRadius: 4 }}
              >
                {frame(s, i)}
                <span className="meta" style={{ fontSize: 11, display: "flex", gap: 6, marginTop: 4 }}>
                  <span>
                    {i + 2} · {sectionName.get(s.sectionId)}
                  </span>
                  {s.origin === "human" && <span style={{ marginLeft: "auto" }}>edited</span>}
                </span>
              </button>
            ))}
            {editor && (
              <button
                className="btn btn-ghost"
                onClick={() => openEditor("Add a slide", blank(firstSection))}
                style={{ aspectRatio: "16 / 9", border: `1px dashed ${muted(25)}`, color: muted(55) }}
              >
                + Add slide
              </button>
            )}
          </div>

          {chosen && (
            <section className="card" style={{ gap: "var(--space-3)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(260px, 2fr)", gap: "var(--space-6)", alignItems: "start" }}>
                {frame(chosen, slides.indexOf(chosen))}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {editor && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-secondary"
                        style={small}
                        onClick={() =>
                          openEditor("Edit slide", {
                            slideId: chosen.id,
                            sectionId: chosen.sectionId,
                            layout: chosen.layout,
                            title: chosen.title,
                            bullets: chosen.bullets,
                            quoteCodeId: chosen.quoteCodeId,
                            notes: chosen.notes ?? "",
                            themeIds: chosen.themeIds,
                            codeIds: chosen.codeIds,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "move", slideId: chosen.id, delta: -1 })}>
                        ↑ Earlier
                      </button>
                      <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "move", slideId: chosen.id, delta: 1 })}>
                        ↓ Later
                      </button>
                      {chosen.lastEdit && (
                        <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "revert", slideId: chosen.id }, "Reverted the last edit.")}>
                          Revert last edit
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        style={small}
                        disabled={busy}
                        onClick={() => (confirming === chosen.id ? (setOpen(null), act({ action: "delete", slideId: chosen.id })) : setConfirming(chosen.id))}
                      >
                        {confirming === chosen.id ? "Delete?" : "Delete"}
                      </button>
                    </div>
                  )}
                  {chosen.lastEdit && (
                    <span className="meta" style={{ fontSize: 11.5 }}>
                      Last edit by {chosen.lastEdit.by}: {chosen.lastEdit.text}
                    </span>
                  )}
                  <div>
                    <span className="kicker" style={{ fontSize: 10 }}>
                      Speaker notes
                    </span>
                    <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5, color: chosen.notes ? undefined : muted(45) }}>{chosen.notes ?? "None."}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className="kicker" style={{ fontSize: 10 }}>
                      Rests on
                    </span>
                    {chosen.themeIds.map((id) => {
                      const t = themeOf.get(id);
                      return t ? (
                        <span key={id} style={{ fontSize: 12.5 }}>
                          <span className="mono" style={{ fontSize: 10.5, color: "var(--color-accent-700)", marginRight: 6 }}>
                            {t.ref}
                          </span>
                          {t.title}
                          {t.status !== "confirmed" && <span className="meta"> · not confirmed</span>}
                        </span>
                      ) : null;
                    })}
                    {chosen.codeIds.map((id) => {
                      const c = codeOf.get(id);
                      return c ? (
                        <span key={id} style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span>
                            <span className="mono" style={{ fontSize: 10, padding: "1px 5px", background: "var(--color-accent-200)", marginRight: 6 }}>
                              {c.key}
                            </span>
                            {c.label}
                            <Link href={`/transcripts/${c.transcriptId}#L${c.line_start}`} className="mono" style={{ fontSize: 10, marginLeft: 6 }}>
                              L{c.line_start} →
                            </Link>
                          </span>
                          <span style={{ color: muted(70), fontStyle: "italic" }}>“{c.verbatim}”</span>
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}

          {leftOut.length > 0 && (
            <section className="card" style={{ gap: 6 }}>
              <span className="card-kicker">Confirmed themes the deck leaves out · {leftOut.length}</span>
              {leftOut.map((t) => (
                <span key={t.id} style={{ fontSize: 12.5 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--color-accent-700)", marginRight: 6 }}>
                    {t.ref}
                  </span>
                  {t.title}
                </span>
              ))}
            </section>
          )}

          {rejections.length > 0 && (
            <section className="card" style={{ gap: "var(--space-2)" }}>
              <span className="card-kicker">Needs review · {rejections.length}</span>
              <span className="meta" style={{ fontSize: 12 }}>
                Slides Claude proposed that didn&apos;t pass the citation checks. Fix one to add it, or dismiss it.
              </span>
              {rejections.map((r) => (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-3)", padding: "6px 0", borderTop: `1px solid ${muted(7)}` }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 12.5 }}>{r.proposal.title ?? "(no headline)"}</span>
                    <span style={{ fontSize: 11.5, color: muted(62) }}>{r.reason}</span>
                  </span>
                  {editor && (
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button
                        className="btn btn-ghost"
                        style={small}
                        onClick={() => {
                          const sec = template.sections.find((s, i) => s.id === r.proposal.section_id || `S${i + 1}` === String(r.proposal.section ?? "").trim().toUpperCase()) ?? template.sections[0];
                          const keys = new Set([...(r.proposal.codes ?? []), ...(r.proposal.quote ? [r.proposal.quote] : [])].map((k) => k.toUpperCase()));
                          const refs = new Set((r.proposal.themes ?? []).map((k) => k.toUpperCase()));
                          openEditor("Fix a proposed slide", {
                            rejectionId: r.id,
                            sectionId: sec?.id ?? firstSection,
                            layout: (["finding", "quote", "statement"].includes(r.proposal.layout ?? "") ? r.proposal.layout : "finding") as SlideSeed["layout"],
                            title: r.proposal.title ?? "",
                            bullets: r.proposal.bullets ?? [],
                            quoteCodeId: codes.find((c) => c.key.toUpperCase() === (r.proposal.quote ?? "").toUpperCase())?.id ?? null,
                            notes: r.proposal.notes ?? "",
                            themeIds: themes.filter((t) => refs.has(t.ref.toUpperCase()) || (r.proposal.theme_ids ?? []).includes(t.id)).map((t) => t.id),
                            codeIds: codes.filter((c) => keys.has(c.key.toUpperCase()) || (r.proposal.code_ids ?? []).includes(c.id)).map((c) => c.id),
                          });
                        }}
                      >
                        Fix
                      </button>
                      <button className="btn btn-ghost" style={small} onClick={() => act({ action: "dismiss", rejectionId: r.id })}>
                        Dismiss
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {seed && product && (
        <SlideEditor
          title={seed.title}
          seed={seed.seed}
          productId={product.id}
          sections={template.sections}
          themes={themes}
          interviews={interviews}
          codes={codes}
          onClose={() => setSeed(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
