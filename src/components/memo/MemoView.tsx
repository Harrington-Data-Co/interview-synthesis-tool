"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { templateAction } from "@/components/templates/TemplatesEditor";
import { EvidenceDrawer, type DrawerQuote, type DrawerSection } from "@/components/evidence/EvidenceDrawer";
import { Notice } from "@/components/ui";
import type { LoadedMemo } from "@/lib/memo/load";
import { ParagraphEditor, type ParagraphSeed } from "./ParagraphEditor";
import { memoAction } from "./types";
import { projectHref } from "@/lib/urls";
import { withBase } from "@/lib/basePath";

/** Stage 05: the findings memo. Written from a memo template and the
 *  project's confirmed themes — every paragraph cites the themes and codes it
 *  rests on, confirmed themes the memo leaves out are listed as the check,
 *  and paragraphs that broke the citation rules wait in Needs review. */
export function MemoView({ projectId, projectPath, editor, memo }: { projectId: string; projectPath: string; editor: boolean; memo: LoadedMemo }) {
  const { templates, library, template, product, paragraphs, themes, interviews, codes, rejections, runs } = memo;
  const router = useRouter();
  // The paragraph whose evidence is open in the drawer, and optionally the
  // one theme of it that was clicked.
  const [open, setOpen] = useState<{ paragraphId: string; themeId?: string } | null>(null);
  const selected = open?.paragraphId ?? null;
  const [seed, setSeed] = useState<{ title: string; seed: ParagraphSeed } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [libraryPick, setLibraryPick] = useState(library[0]?.id ?? "");
  // A draft only while the headline is being edited; otherwise the saved one.
  const [title, setTitle] = useState<string | null>(null);

  const themeById = new Map(themes.map((t) => [t.id, t]));
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const interviewById = new Map(interviews.map((i) => [i.id, i]));
  const stageHref = (tid: string) => projectHref(projectPath, "memo", { template: tid });
  const confirmed = themes.filter((t) => t.status === "confirmed");
  const citedThemes = new Set(paragraphs.flatMap((p) => p.themeIds));
  const leftOut = confirmed.filter((t) => !citedThemes.has(t.id));
  const claudeItems = paragraphs.filter((p) => p.origin === "claude").length;
  const lastRun = runs[0];
  const small = { fontSize: 11.5, padding: "2px 8px" } as const;

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  // Codes in interview order, then by line, as the corpus drawer lists them.
  const order = new Map(interviews.map((iv, i) => [iv.id, i]));
  const quotesOf = (ids: string[]): DrawerQuote[] =>
    ids
      .map((id) => codeById.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => (order.get(a.transcriptId) ?? 0) - (order.get(b.transcriptId) ?? 0) || a.line_start - b.line_start)
      .map((c) => ({ id: c.id, transcriptId: c.transcriptId, ref: c.ref, type: c.type, label: c.label, verbatim: c.verbatim, start: c.line_start, end: c.line_end }));
  const themeSection = (tid: string): DrawerSection | null => {
    const t = themeById.get(tid);
    if (!t) return null;
    const n = new Set(t.codeIds.map((c) => codeById.get(c)?.transcriptId)).size;
    return {
      key: tid,
      heading: { ref: t.ref, title: t.title, note: `${t.codeIds.length} codes · ${n} of ${interviews.length} interviews${t.status === "proposed" ? " · not confirmed" : ""}` },
      quotes: quotesOf(t.codeIds),
    };
  };
  const drawer = (() => {
    const p = open && paragraphs.find((x) => x.id === open.paragraphId);
    if (!p || !template) return null;
    const section = template.sections.find((s) => s.id === p.sectionId);
    if (open.themeId) {
      const t = themeById.get(open.themeId);
      const sec = themeSection(open.themeId);
      return t && sec ? { kicker: `${t.ref} · cited in ${section?.name ?? "the memo"}`, title: t.title, sections: [sec] } : null;
    }
    const sections: DrawerSection[] = [];
    if (p.codeIds.length) sections.push({ key: "codes", heading: { title: "Codes cited directly" }, quotes: quotesOf(p.codeIds) });
    for (const tid of p.themeIds) {
      const sec = themeSection(tid);
      if (sec) sections.push(sec);
    }
    return { kicker: `Evidence · ${section?.name ?? "paragraph"}`, title: p.text, sections };
  })();

  async function act(body: Record<string, unknown>, done?: string) {
    if (!product) return;
    setBusy(true);
    setNotice(null);
    const { error } = await memoAction(product.id, body);
    setBusy(false);
    setConfirming(null);
    if (error) return setNotice({ tone: "error", text: error });
    if (done) setNotice({ tone: "info", text: done });
    router.refresh();
  }

  async function generate(replace: boolean) {
    if (!template) return;
    setRunning(true);
    setNotice(null);
    setConfirming(null);
    const res = await fetch(withBase(`/api/projects/${projectId}/memo`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: template.id, replace }),
    });
    const b = await res.json().catch(() => ({}));
    setRunning(false);
    if (!res.ok) setNotice({ tone: "error", text: b.error ?? `Writing the memo failed (${res.status}).` });
    else {
      const cost = typeof b.costUsd === "number" ? ` · $${b.costUsd.toFixed(2)}` : "";
      setNotice({ tone: "info", text: `Memo written: ${b.accepted} paragraphs${b.rejected ? `, ${b.rejected} waiting in Needs review` : ""}${cost}.` });
    }
    router.refresh();
  }

  async function addTemplate() {
    setBusy(true);
    const { error, id } = await templateAction({ kind: "memo", action: "addToProject", templateId: libraryPick, projectId });
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: error });
    router.push(stageHref(id!));
    router.refresh();
  }

  async function saveTitle() {
    if (!product || title === null) return;
    const next = title.trim();
    if (next !== (product.title ?? "")) await act({ action: "title", title: next });
    setTitle(null);
  }

  if (!template) {
    return (
      <div className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p className="meta" style={{ margin: 0 }}>This project has no memo templates yet.</p>
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
            The memo template library is empty. <Link href="/templates?kind=memo">Set one up on the Templates page.</Link>
          </p>
        )}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>
    );
  }

  const openEditor = (t: string, s: ParagraphSeed) => setSeed({ title: t, seed: s });
  const firstSection = template.sections[0]?.id ?? "";

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
        <Link href={`/templates?kind=memo&t=${template.id}`} className="meta" style={{ fontSize: 12 }}>
          Edit template
        </Link>
        {product && paragraphs.length > 0 && (
          <>
            <a href={withBase(`/api/memos/${product.id}/markdown`)} className="meta" style={{ fontSize: 12 }} download>
              Markdown
            </a>
            <Link href={`${projectHref(projectPath, "memo")}/print?template=${template.id}`} className="meta" style={{ fontSize: 12 }} target="_blank">
              Print / PDF
            </Link>
          </>
        )}
        {editor && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {lastRun && !running && (
              <span className="meta" style={{ fontSize: 11.5 }}>
                Last run {new Date(lastRun.started_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} by {lastRun.started_by}
                {lastRun.status === "done" && ` · ${lastRun.accepted} paragraphs, ${lastRun.rejected} for review${lastRun.cost_usd !== null ? ` · $${Number(lastRun.cost_usd).toFixed(2)}` : ""}`}
                {lastRun.status === "failed" && ` · failed: ${lastRun.error}`}
              </span>
            )}
            {running ? (
              <span className="btn" role="status" style={{ cursor: "default", fontWeight: 500 }}>
                Writing the memo…
              </span>
            ) : claudeItems === 0 ? (
              <button className="btn btn-primary" onClick={() => generate(false)} disabled={busy || !confirmed.length} title={confirmed.length ? undefined : "Confirm some themes first."}>
                Generate memo
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={() => (confirming === "regen" ? generate(true) : setConfirming("regen"))} disabled={busy}>
                {confirming === "regen" ? `Replace ${claudeItems} generated paragraphs? Yours stay.` : "Regenerate"}
              </button>
            )}
          </span>
        )}
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {!product ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta" style={{ margin: 0 }}>
            No memo from {template.name} yet.
            {editor &&
              (confirmed.length
                ? ` Generate one from the ${confirmed.length} confirmed theme${confirmed.length === 1 ? "" : "s"}.`
                : " Confirm themes on the Themes tab first — the memo is written from them.")}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)", alignItems: "flex-start" }}>
          {/* ── the memo ── */}
          <section className="panel" style={{ flex: "2 1 560px", minWidth: 0, padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">
                Findings memo · {memo.project.name}
                {memo.project.client ? ` · ${memo.project.client}` : ""}
              </span>
              {editor ? (
                <input
                  className="input"
                  value={title ?? product.title ?? ""}
                  placeholder="Headline"
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  style={{ fontSize: 20, fontWeight: 700, border: "none", padding: 0, background: "transparent" }}
                />
              ) : (
                <h2 style={{ margin: 0, fontSize: 20 }}>{product.title ?? template.name}</h2>
              )}
              <span className="meta" style={{ fontSize: 12 }}>
                Cites {citedThemes.size} of {confirmed.length} confirmed themes · {interviews.length} interviews · click a paragraph or theme for its evidence
              </span>
            </div>
            {template.sections.map((s, si) => {
              const inSection = paragraphs.filter((p) => p.sectionId === s.id).sort((a, b) => a.ordinal - b.ordinal);
              return (
                <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="mono meta">{String(si + 1).padStart(2, "0")}</span>
                    <h4 style={{ margin: 0, fontSize: 15 }}>{s.name}</h4>
                    {editor && (
                      <button
                        className="btn btn-ghost"
                        style={{ ...small, marginLeft: "auto" }}
                        onClick={() => openEditor(`Add to ${s.name}`, { sectionId: s.id, text: "", themeIds: [], codeIds: [] })}
                      >
                        + Add paragraph
                      </button>
                    )}
                  </div>
                  {!inSection.length && (
                    <span className="meta" style={{ fontSize: 12.5, paddingLeft: 26 }}>
                      Nothing here.
                    </span>
                  )}
                  {inSection.map((p, pi) => (
                    <div
                      key={p.id}
                      onClick={() => setOpen(selected === p.id && !open?.themeId ? null : { paragraphId: p.id })}
                      title="Show the evidence for this paragraph"
                      style={{
                        paddingLeft: 26,
                        paddingTop: 4,
                        paddingBottom: 4,
                        cursor: "pointer",
                        borderLeft: `3px solid ${selected === p.id ? "var(--color-accent)" : "transparent"}`,
                        background: selected === p.id ? "var(--color-accent-tint-soft)" : undefined,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{p.text}</p>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {p.themeIds.map((tid) => (
                          <button
                            key={tid}
                            type="button"
                            className="tag tag-accent"
                            title={`${themeById.get(tid)?.title ?? ""} — show this theme's quotes`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen({ paragraphId: p.id, themeId: tid });
                            }}
                            style={{
                              font: "inherit",
                              fontSize: 10.5,
                              cursor: "pointer",
                              outline: open?.paragraphId === p.id && open.themeId === tid ? "2px solid var(--color-accent-600)" : undefined,
                            }}
                          >
                            {themeById.get(tid)?.ref ?? "?"}
                          </button>
                        ))}
                        {p.codeIds.map((cid) => (
                          <span key={cid} className="tag tag-neutral" title={codeById.get(cid)?.label} style={{ fontSize: 10.5 }}>
                            {codeById.get(cid)?.key ?? "?"}
                          </span>
                        ))}
                        {p.lastEdit && (
                          <span className="meta" style={{ fontSize: 11 }}>
                            edited by {p.lastEdit.by}
                          </span>
                        )}
                        {editor && (
                          <span style={{ marginLeft: "auto", display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                            <button
                              className="btn btn-ghost"
                              style={small}
                              onClick={() => openEditor("Edit paragraph", { itemId: p.id, sectionId: p.sectionId, text: p.text, themeIds: p.themeIds, codeIds: p.codeIds })}
                            >
                              Edit
                            </button>
                            <button className="btn btn-ghost" style={small} disabled={busy || pi === 0} onClick={() => act({ action: "move", itemId: p.id, delta: -1 })} aria-label="Move up">
                              ↑
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={small}
                              disabled={busy || pi === inSection.length - 1}
                              onClick={() => act({ action: "move", itemId: p.id, delta: 1 })}
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                            {p.lastEdit && (
                              <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "revert", itemId: p.id }, `Reverted: ${p.lastEdit!.text}`)}>
                                Revert
                              </button>
                            )}
                            <button
                              className="btn btn-ghost"
                              style={small}
                              disabled={busy}
                              onClick={() => (confirming === p.id ? act({ action: "delete", itemId: p.id }) : setConfirming(p.id))}
                            >
                              {confirming === p.id ? "Remove?" : "Remove"}
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>

          {/* ── evidence, coverage, review ── */}
          <aside style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="card" style={{ gap: "var(--space-2)" }}>
              <span className="card-kicker">Coverage</span>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>Confirmed themes in the memo</span>
                <span className="mono">
                  {confirmed.length - leftOut.length} / {confirmed.length}
                </span>
              </div>
              <div style={{ height: 6, background: "var(--color-neutral-100)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${confirmed.length ? ((confirmed.length - leftOut.length) / confirmed.length) * 100 : 0}%`,
                    background: "var(--color-accent)",
                  }}
                />
              </div>
              {leftOut.length ? (
                <>
                  <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                    Left out — confirmed, but no paragraph cites them.
                  </p>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {leftOut.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="tag tag-outline"
                        title={editor ? `${t.title} — add a paragraph citing it` : t.title}
                        disabled={!editor}
                        onClick={() =>
                          openEditor(`Add a paragraph citing ${t.ref}`, {
                            sectionId: template.sections.find((s) => !s.requires.length || s.requires.includes("themes"))?.id ?? firstSection,
                            text: "",
                            themeIds: [t.id],
                            codeIds: [],
                          })
                        }
                        style={{ cursor: editor ? "pointer" : "default", font: "inherit", fontSize: 10.5 }}
                      >
                        {t.ref}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                  Every confirmed theme is in the memo.
                </p>
              )}
            </div>

            {rejections.length > 0 && (
              <div className="panel" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", background: "var(--color-accent-100)" }}>
                <strong style={{ fontSize: 13 }}>
                  Needs review · {rejections.length} generated paragraph{rejections.length === 1 ? "" : "s"} broke the citation rules
                </strong>
                {rejections.map((r) => {
                  const refs = [...(r.proposal.themes ?? []), ...(r.proposal.codes ?? [])];
                  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");
                  const wanted = new Set(refs.map(norm));
                  const sectionKey = (r.proposal.section ?? "").match(/^S(\d+)/i);
                  const sectionId =
                    r.proposal.section_id ??
                    (sectionKey ? template.sections[Number(sectionKey[1]) - 1]?.id : undefined) ??
                    template.sections.find((s) => s.name.toLowerCase() === (r.proposal.section ?? "").trim().toLowerCase())?.id ??
                    firstSection;
                  const themeIds = r.proposal.theme_ids ?? themes.filter((t) => wanted.has(norm(t.ref))).map((t) => t.id);
                  const codeIds = r.proposal.code_ids ?? codes.filter((c) => wanted.has(norm(c.key))).map((c) => c.id);
                  return (
                    <div key={r.id} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 12.5 }}>{r.proposal.text ?? "(no text)"}</span>
                      <span className="mono meta" style={{ fontSize: 11 }}>
                        {refs.join(", ") || "no citations"}
                      </span>
                      <span className="meta" style={{ fontSize: 11.5 }}>
                        {r.reason}
                      </span>
                      {editor && (
                        <span style={{ display: "flex", gap: 6 }}>
                          <button
                            className="btn btn-secondary"
                            style={small}
                            onClick={() => openEditor("Fix a generated paragraph", { rejectionId: r.id, sectionId, text: r.proposal.text ?? "", themeIds, codeIds })}
                          >
                            Fix
                          </button>
                          <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "dismiss", rejectionId: r.id })}>
                            Dismiss
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      )}

      {drawer && <EvidenceDrawer kicker={drawer.kicker} title={drawer.title} sections={drawer.sections} interviews={interviewById} onClose={() => setOpen(null)} />}

      {seed && product && (
        <ParagraphEditor
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
