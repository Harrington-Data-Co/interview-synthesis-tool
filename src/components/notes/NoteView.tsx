"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { templateAction } from "@/components/templates/TemplatesEditor";
import { Notice } from "@/components/ui";
import { ItemEditor, type ItemSeed } from "./ItemEditor";
import {
  addr,
  itemAction,
  type CoverageRow,
  type NoteCodeView,
  type NoteItemView,
  type NoteRejectionView,
  type NoteRunView,
  type NoteTemplateView,
} from "./types";

/** Stage 03: the interview note. A rearrangement of the interview's codes
 *  into a template's sections — every item cites the codes it rests on, the
 *  coverage card shows what was left out, and proposals that broke the
 *  citation rules wait in Needs review. */
export function NoteView({
  transcriptId,
  projectId,
  editor,
  templates,
  library,
  template,
  noteId,
  notedTemplateIds,
  items,
  codes,
  coverage,
  rejections,
  runs,
}: {
  transcriptId: string;
  projectId: string | null;
  editor: boolean;
  templates: NoteTemplateView[];
  library: { id: string; name: string }[];
  template: NoteTemplateView | null;
  noteId: string | null;
  notedTemplateIds: string[];
  items: NoteItemView[];
  codes: NoteCodeView[];
  coverage: CoverageRow[];
  rejections: NoteRejectionView[];
  runs: NoteRunView[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ title: string; seed: ItemSeed } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [libraryPick, setLibraryPick] = useState(library[0]?.id ?? "");

  const byId = new Map(codes.map((c) => [c.id, c]));
  const stageHref = (tid: string) => `/transcripts/${transcriptId}?stage=notes&template=${tid}`;
  const used = coverage.filter((c) => c.used).length;
  const unused = coverage.filter((c) => !c.used);
  const claudeItems = items.filter((i) => i.origin === "claude").length;
  const chosen = items.find((i) => i.id === selected);
  const lastRun = runs[0];
  const small = { fontSize: 11.5, padding: "2px 8px" } as const;

  async function act(body: Record<string, unknown>, done?: string) {
    if (!noteId) return;
    setBusy(true);
    setNotice(null);
    const { error } = await itemAction(noteId, body);
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
    const res = await fetch(`/api/transcripts/${transcriptId}/note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: template.id, replace }),
    });
    const b = await res.json().catch(() => ({}));
    setRunning(false);
    if (!res.ok) setNotice({ tone: "error", text: b.error ?? `Generating failed (${res.status}).` });
    else {
      const cost = typeof b.costUsd === "number" ? ` · $${b.costUsd.toFixed(2)}` : "";
      setNotice({ tone: "info", text: `Note written: ${b.accepted} items${b.rejected ? `, ${b.rejected} waiting in Needs review` : ""}${cost}.` });
    }
    router.refresh();
  }

  async function addTemplate() {
    setBusy(true);
    const { error, id } = await templateAction({ action: "addToProject", templateId: libraryPick, projectId });
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: error });
    router.push(stageHref(id!));
    router.refresh();
  }

  if (!projectId) {
    return (
      <div className="panel" style={{ padding: "var(--space-4)" }}>
        <p className="meta" style={{ margin: 0 }}>
          Notes are written from a project&apos;s templates. Assign this interview to a project first.
        </p>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p className="meta" style={{ margin: 0 }}>This project has no note templates yet.</p>
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
            The template library is empty. <Link href="/templates">Set one up on the Templates page.</Link>
          </p>
        )}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>
    );
  }

  const openEditor = (title: string, s: ItemSeed) => setSeed({ title, seed: s });

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
            {notedTemplateIds.includes(t.id) ? " •" : ""}
          </Link>
        ))}
        <Link href={`/templates?t=${template.id}`} className="meta" style={{ fontSize: 12 }}>
          Edit template
        </Link>
        {editor && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {lastRun && !running && (
              <span className="meta" style={{ fontSize: 11.5 }}>
                Last run {new Date(lastRun.started_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} by {lastRun.started_by}
                {lastRun.status === "done" && ` · ${lastRun.accepted} items, ${lastRun.rejected} for review${lastRun.cost_usd !== null ? ` · $${Number(lastRun.cost_usd).toFixed(2)}` : ""}`}
                {lastRun.status === "failed" && ` · failed: ${lastRun.error}`}
              </span>
            )}
            {running ? (
              <span className="btn" role="status" style={{ cursor: "default", fontWeight: 500 }}>
                Writing the note…
              </span>
            ) : claudeItems === 0 ? (
              <button className="btn btn-primary" onClick={() => generate(false)} disabled={busy}>
                Generate note
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={() => (confirming === "regen" ? generate(true) : setConfirming("regen"))} disabled={busy}>
                {confirming === "regen" ? `Replace ${claudeItems} generated items? Yours stay.` : "Regenerate"}
              </button>
            )}
          </span>
        )}
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {!noteId ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta" style={{ margin: 0 }}>
            No note from {template.name} yet.{editor ? " Generate one from this interview's codes." : ""}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)", alignItems: "flex-start" }}>
          {/* ── the note ── */}
          <section className="panel" style={{ flex: "2 1 560px", minWidth: 0, padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">Interview note · {template.name}</span>
              <span className="meta" style={{ fontSize: 12 }}>
                Assembled from {used} of {coverage.length} codes
              </span>
            </div>
            {template.sections.map((s, si) => {
              const inSection = items.filter((i) => i.sectionId === s.id).sort((a, b) => a.ordinal - b.ordinal);
              return (
                <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="mono meta">{String(si + 1).padStart(2, "0")}</span>
                    <h4 style={{ margin: 0, fontSize: 15 }}>{s.name}</h4>
                    {editor && (
                      <button
                        className="btn btn-ghost"
                        style={{ ...small, marginLeft: "auto" }}
                        onClick={() => openEditor(`Add to ${s.name}`, { sectionId: s.id, text: "", codeIds: [] })}
                      >
                        + Add item
                      </button>
                    )}
                  </div>
                  {!inSection.length && (
                    <span className="meta" style={{ fontSize: 12.5, paddingLeft: 26 }}>
                      Nothing here.
                    </span>
                  )}
                  {inSection.map((it, ii) => (
                    <div
                      key={it.id}
                      onClick={() => setSelected(it.id)}
                      style={{
                        paddingLeft: 26,
                        paddingTop: 4,
                        paddingBottom: 4,
                        cursor: "pointer",
                        borderLeft: `3px solid ${selected === it.id ? "var(--color-accent)" : "transparent"}`,
                        background: selected === it.id ? "var(--color-accent-tint-soft)" : undefined,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{it.text}</p>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {it.codeIds.map((cid) => (
                          <span key={cid} className="tag tag-neutral" title={byId.get(cid)?.label} style={{ fontSize: 10.5 }}>
                            {byId.get(cid)?.ref ?? "?"}
                          </span>
                        ))}
                        {it.lastEdit && (
                          <span className="meta" style={{ fontSize: 11 }}>
                            edited by {it.lastEdit.by}
                          </span>
                        )}
                        {editor && (
                          <span style={{ marginLeft: "auto", display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                            <button className="btn btn-ghost" style={small} onClick={() => openEditor("Edit item", { itemId: it.id, sectionId: it.sectionId, text: it.text, codeIds: it.codeIds })}>
                              Edit
                            </button>
                            <button className="btn btn-ghost" style={small} disabled={busy || ii === 0} onClick={() => act({ action: "move", itemId: it.id, delta: -1 })} aria-label="Move up">
                              ↑
                            </button>
                            <button className="btn btn-ghost" style={small} disabled={busy || ii === inSection.length - 1} onClick={() => act({ action: "move", itemId: it.id, delta: 1 })} aria-label="Move down">
                              ↓
                            </button>
                            {it.lastEdit && (
                              <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "revert", itemId: it.id }, `Reverted: ${it.lastEdit!.text}`)}>
                                Revert
                              </button>
                            )}
                            <button
                              className="btn btn-ghost"
                              style={small}
                              disabled={busy}
                              onClick={() => (confirming === it.id ? act({ action: "delete", itemId: it.id }) : setConfirming(it.id))}
                            >
                              {confirming === it.id ? "Remove?" : "Remove"}
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
            <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
              The note is a <em>rearrangement</em>, not a rewrite: the template decides the sections; the codes decide what fills them.
            </p>

            <div className="card" style={{ gap: "var(--space-2)" }}>
              <span className="card-kicker">Evidence for the selected item</span>
              {!chosen ? (
                <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
                  Click an item in the note to see what it rests on.
                </p>
              ) : (
                chosen.codeIds.map((cid) => {
                  const c = byId.get(cid);
                  if (!c) return null;
                  return (
                    <div key={cid} style={{ display: "flex", flexDirection: "column", gap: 2, borderTop: "1px solid var(--line-1)", paddingTop: 6 }}>
                      <span style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                        <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
                          {c.ref}
                        </span>
                        <span className="tag tag-neutral">{c.type}</span>
                        <Link href={`/transcripts/${transcriptId}#L${c.line_start}`} className="mono meta" style={{ fontSize: 11, marginLeft: "auto" }}>
                          {addr(c)} ↗
                        </Link>
                      </span>
                      <span style={{ fontSize: 12.5, fontStyle: "italic" }}>“{c.verbatim}”</span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="card" style={{ gap: "var(--space-2)" }}>
              <span className="card-kicker">Coverage</span>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>Codes used in the note</span>
                <span className="mono">
                  {used} / {coverage.length}
                </span>
              </div>
              <div style={{ height: 6, background: "var(--color-neutral-100)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${coverage.length ? (used / coverage.length) * 100 : 0}%`, background: "var(--color-accent)" }} />
              </div>
              {unused.length ? (
                <>
                  <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                    Left out — coded, but not in any section. Left-out codes are the check for a note that dropped something.
                  </p>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {unused.map((c) => (
                      <button
                        key={c.code_id}
                        type="button"
                        className="tag tag-outline"
                        title={editor ? `${c.label} — add an item citing it` : c.label}
                        disabled={!editor}
                        onClick={() =>
                          openEditor(`Add an item citing ${c.ref}`, { sectionId: template.sections[0]?.id ?? "", text: "", codeIds: [c.code_id] })
                        }
                        style={{ cursor: editor ? "pointer" : "default", font: "inherit", fontSize: 10.5 }}
                      >
                        {c.ref}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                  Nothing left out — every code landed in a section.
                </p>
              )}
            </div>

            {rejections.length > 0 && (
              <div className="panel" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", background: "var(--color-accent-100)" }}>
                <strong style={{ fontSize: 13 }}>Needs review · {rejections.length} generated item{rejections.length === 1 ? "" : "s"} broke the citation rules</strong>
                {rejections.map((r) => {
                  const refs = r.proposal.refs ?? (r.proposal.code_ids ?? []).map((id) => byId.get(id)?.ref ?? "?");
                  const sectionId =
                    r.proposal.section_id ??
                    template.sections[Number((r.proposal.section ?? "").replace(/^S/i, "")) - 1]?.id ??
                    template.sections[0]?.id ??
                    "";
                  const codeIds = (r.proposal.code_ids ?? codes.filter((c) => refs.includes(c.ref)).map((c) => c.id)).filter(
                    (id) => !byId.get(id)?.merged_into_id,
                  );
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
                            onClick={() => openEditor("Fix a generated item", { rejectionId: r.id, sectionId, text: r.proposal.text ?? "", codeIds })}
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

      {seed && noteId && (
        <ItemEditor
          title={seed.title}
          seed={seed.seed}
          noteId={noteId}
          sections={template.sections}
          codes={codes}
          onClose={() => setSeed(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
