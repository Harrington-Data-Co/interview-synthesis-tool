"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";
import { CodeEditor, type EditorSeed } from "./CodeEditor";
import {
  addr,
  codeAction,
  CODE_TYPES,
  type CodeRow,
  type CodeType,
  type LineRow,
  type RejectionRow,
  type RunRow,
} from "./types";

const PANEL_HEIGHT = "74vh";

/** Stage 02: the transcript marked up with its codes, beside the codes
 *  themselves. Selecting a line shows its codes; selecting a code shows its
 *  lines. Claude's pass runs from here, its rejected proposals wait in Needs
 *  review, and people add, edit, merge, split and delete codes. */
export function CodingView({
  transcriptId,
  lines,
  codes,
  rejections,
  runs,
  editor,
}: {
  transcriptId: string;
  lines: LineRow[];
  codes: CodeRow[];
  rejections: RejectionRow[];
  runs: RunRow[];
  editor: boolean;
}) {
  const router = useRouter();
  const linesRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [typeFilter, setTypeFilter] = useState<CodeType | "">("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [editorSeed, setEditorSeed] = useState<{ title: string; seed: EditorSeed } | null>(null);
  const [merging, setMerging] = useState<{ keepId: string; ids: Set<string> } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ seed: EditorSeed; x: number; y: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const active = codes.filter((c) => !c.merged_into_id);
  const byId = new Map(codes.map((c) => [c.id, c]));
  const claudeCount = codes.filter((c) => c.origin === "claude").length;
  const shown = active.filter((c) => !typeFilter || c.type === typeFilter);
  const codesOnLine = (n: number) => active.filter((c) => n >= c.line_start && n <= c.line_end);
  const marked = lines.filter((l) => codesOnLine(l.n).length).length;
  const chosen = selectedCode ? byId.get(selectedCode) : undefined;
  const lastRun = runs[0];

  const reveal = (container: HTMLDivElement | null, selector: string) =>
    requestAnimationFrame(() =>
      container?.querySelector(selector)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );

  const pickCode = (id: string) => {
    const c = byId.get(id);
    setSelectedCode(id);
    setSelectedLine(null);
    if (c) reveal(linesRef.current, `[data-line="${c.line_start}"]`);
  };
  const pickLine = (n: number) => {
    setSelectedLine(n);
    setSelectedCode(null);
    const first = codesOnLine(n)[0];
    if (first) reveal(cardsRef.current, `[data-code="${first.id}"]`);
  };

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    setNotice(null);
    const { error } = await codeAction(transcriptId, body);
    setBusy(false);
    setConfirming(null);
    if (error) return setNotice({ tone: "error", text: error });
    if (done) setNotice({ tone: "info", text: done });
    router.refresh();
  }

  async function runCoding(replace: boolean) {
    setRunning(true);
    setNotice(null);
    setConfirming(null);
    const res = await fetch(`/api/transcripts/${transcriptId}/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ replace }),
    });
    const b = await res.json().catch(() => ({}));
    setRunning(false);
    if (!res.ok) {
      setNotice({ tone: "error", text: b.error ?? `Coding failed (${res.status}).` });
    } else {
      const cost = typeof b.costUsd === "number" ? ` · $${b.costUsd.toFixed(2)}` : "";
      setNotice({
        tone: "info",
        text: `Coded: ${b.accepted} codes kept${b.rejected ? `, ${b.rejected} waiting in Needs review` : ""}${cost}.`,
      });
    }
    router.refresh();
  }

  /** Text selected inside the lines panel becomes a new code's quote and range. */
  function captureSelection() {
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !linesRef.current) return setSelection(null);
    const range = sel.getRangeAt(0);
    const spans = [...linesRef.current.querySelectorAll<HTMLElement>("[data-text]")].filter((s) =>
      range.intersectsNode(s),
    );
    if (!spans.length) return setSelection(null);
    const parts = spans.map((s) => {
      const node = s.firstChild;
      const text = node?.textContent ?? "";
      const from = node && range.startContainer === node ? range.startOffset : 0;
      const to = node && range.endContainer === node ? range.endOffset : text.length;
      return text.slice(from, to);
    });
    const verbatim = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!verbatim) return setSelection(null);
    const rect = range.getBoundingClientRect();
    setSelection({
      seed: {
        type: "Pain",
        label: "",
        note: "",
        verbatim,
        line_start: Number(spans[0].dataset.text),
        line_end: Number(spans[spans.length - 1].dataset.text),
      },
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

  const pill = (value: CodeType | "", text: string, count: number) => (
    <button
      key={value || "all"}
      className="btn"
      onClick={() => setTypeFilter(value)}
      style={{
        fontSize: 12,
        padding: "3px 10px",
        background: typeFilter === value ? "var(--color-accent-tint)" : "transparent",
        color: typeFilter === value ? "var(--color-accent-800)" : "var(--color-text)",
        fontWeight: typeFilter === value ? 700 : 500,
      }}
    >
      {text} <span className="mono" style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );

  const small = { fontSize: 11.5, padding: "2px 8px" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)", alignItems: "flex-start" }}>
        {/* ── the transcript, marked up ── */}
        <section style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Transcript, marked up</h3>
            <span className="meta" style={{ fontSize: 12 }}>
              {marked} of {lines.length} turns carry a code
              {editor && " · select text to code it"}
            </span>
          </div>
          <div
            ref={linesRef}
            className="panel"
            onMouseUp={captureSelection}
            style={{ background: "var(--color-surface)", maxHeight: PANEL_HEIGHT, overflow: "auto", padding: "var(--space-2) 0" }}
          >
            {lines.map((l) => {
              const here = codesOnLine(l.n);
              const inChosen = chosen && l.n >= chosen.line_start && l.n <= chosen.line_end;
              const lineSelected = selectedLine === l.n;
              return (
                <div
                  key={l.n}
                  data-line={l.n}
                  onClick={() => {
                    if (!window.getSelection()?.toString()) pickLine(l.n);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "38px 1fr",
                    gap: "var(--space-4)",
                    padding: "5px var(--space-4)",
                    cursor: "pointer",
                    background: inChosen || lineSelected ? "var(--color-accent-tint-soft)" : undefined,
                    boxShadow: `inset 3px 0 0 ${inChosen ? "var(--color-accent)" : here.length ? "var(--color-accent-tint-border)" : "transparent"}`,
                    opacity: l.role === "interviewer" ? 0.72 : 1,
                  }}
                >
                  <span className="mono" style={{ fontSize: 10, lineHeight: 1.7, textAlign: "right", color: "color-mix(in srgb, var(--color-text) 38%, transparent)" }}>
                    L{l.n}
                  </span>
                  <div>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", marginRight: 8, userSelect: "none" }}>
                        {l.speaker}
                      </span>
                      <span data-text={l.n}>{l.text}</span>
                    </p>
                    {here.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3, userSelect: "none" }}>
                        {here.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={`tag ${selectedCode === c.id ? "tag-accent" : "tag-neutral"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              pickCode(c.id);
                              reveal(cardsRef.current, `[data-code="${c.id}"]`);
                            }}
                            title={c.label}
                            style={{ cursor: "pointer", font: "inherit", fontSize: 10.5 }}
                          >
                            {c.ref}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── what was pulled out ── */}
        <section style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>What was pulled out</h3>
            <span className="meta" style={{ fontSize: 12 }}>
              {shown.length} code{shown.length === 1 ? "" : "s"} shown
            </span>
          </div>

          {editor && (
            <div className="panel" style={{ padding: "var(--space-2) var(--space-3)", display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              {running ? (
                <span style={{ fontSize: 13 }}>Coding this transcript — usually one to three minutes…</span>
              ) : claudeCount === 0 ? (
                <button className="btn btn-primary" onClick={() => runCoding(false)} disabled={busy}>
                  Code
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={() => (confirming === "rerun" ? runCoding(true) : setConfirming("rerun"))}
                  disabled={busy}
                >
                  {confirming === "rerun" ? `Replace ${claudeCount} codes from the last run? Yours stay.` : "Re-code"}
                </button>
              )}
              {lastRun && !running && (
                <span className="meta" style={{ fontSize: 11.5 }}>
                  Last run {new Date(lastRun.started_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} by{" "}
                  {lastRun.started_by}
                  {lastRun.status === "done" &&
                    ` · ${lastRun.accepted} kept, ${lastRun.rejected} for review${lastRun.cost_usd !== null ? ` · $${Number(lastRun.cost_usd).toFixed(2)}` : ""}`}
                  {lastRun.status === "failed" && ` · failed: ${lastRun.error}`}
                  {lastRun.status === "running" && " · still running"}
                </span>
              )}
              <button
                className="btn btn-ghost"
                style={{ marginLeft: "auto", fontSize: 12 }}
                onClick={() =>
                  setEditorSeed({
                    title: "New code",
                    seed: { type: "Pain", label: "", note: "", verbatim: "", line_start: selectedLine ?? 1, line_end: selectedLine ?? 1 },
                  })
                }
              >
                + New code
              </button>
            </div>
          )}

          {rejections.length > 0 && (
            <div className="panel" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", background: "var(--color-accent-100)" }}>
              <strong style={{ fontSize: 13 }}>
                Needs review · {rejections.length} of Claude&apos;s proposals didn&apos;t pass the quote check
              </strong>
              {rejections.map((r) => (
                <div key={r.id} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 12.5 }}>
                    <span className="tag tag-neutral">{r.proposal.type ?? "?"}</span>{" "}
                    <strong>{r.proposal.label ?? "(no label)"}</strong>{" "}
                    <span className="mono meta" style={{ fontSize: 11 }}>
                      {r.proposal.line_start !== undefined ? addr({ line_start: r.proposal.line_start, line_end: r.proposal.line_end ?? r.proposal.line_start }) : ""}
                    </span>
                  </span>
                  <span style={{ fontSize: 12.5, fontStyle: "italic" }}>“{r.proposal.verbatim}”</span>
                  <span className="meta" style={{ fontSize: 11.5 }}>{r.reason}</span>
                  {editor && (
                    <span style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn-secondary"
                        style={small}
                        onClick={() =>
                          setEditorSeed({
                            title: "Fix Claude's proposal",
                            seed: {
                              rejectionId: r.id,
                              type: (CODE_TYPES as readonly string[]).includes(r.proposal.type ?? "") ? (r.proposal.type as CodeType) : "Pain",
                              label: r.proposal.label ?? "",
                              note: r.proposal.note ?? "",
                              verbatim: r.proposal.verbatim ?? "",
                              line_start: r.proposal.line_start ?? 1,
                              line_end: r.proposal.line_end ?? r.proposal.line_start ?? 1,
                            },
                          })
                        }
                      >
                        Fix
                      </button>
                      <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "dismiss", rejectionId: r.id })}>
                        Dismiss
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {pill("", "All", active.length)}
            {CODE_TYPES.filter((t) => active.some((c) => c.type === t)).map((t) =>
              pill(t, t, active.filter((c) => c.type === t).length),
            )}
          </div>

          {merging && (
            <div className="panel" style={{ padding: "var(--space-2) var(--space-3)", display: "flex", gap: "var(--space-2)", alignItems: "center", background: "var(--color-navy)", color: "#FFFFFF" }}>
              <span style={{ fontSize: 12.5 }}>
                Tick the codes to fold into <strong>{byId.get(merging.keepId)?.ref}</strong>
              </span>
              <button
                className="btn"
                style={{ fontSize: 12, color: "#FFFFFF", borderColor: "rgba(242,242,243,.45)", marginLeft: "auto" }}
                disabled={busy || merging.ids.size === 0}
                onClick={() =>
                  act({ action: "merge", keepId: merging.keepId, mergeIds: [...merging.ids] }, "Merged.").then(() => setMerging(null))
                }
              >
                Merge {merging.ids.size || ""}
              </button>
              <button className="btn" style={{ fontSize: 12, color: "#FFFFFF", borderColor: "rgba(242,242,243,.25)" }} onClick={() => setMerging(null)}>
                Cancel
              </button>
            </div>
          )}

          <div ref={cardsRef} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: PANEL_HEIGHT, overflow: "auto", paddingRight: 2 }}>
            {!shown.length && (
              <div className="panel" style={{ padding: "var(--space-4)" }}>
                <p className="meta" style={{ margin: 0 }}>
                  {active.length ? "No codes of this type." : editor ? "No codes yet. Press Code, or select text in the transcript to code it yourself." : "No codes yet."}
                </p>
              </div>
            )}
            {shown.map((c) => {
              const on = selectedCode === c.id || (selectedLine !== null && selectedLine >= c.line_start && selectedLine <= c.line_end);
              const folded = codes.filter((m) => m.merged_into_id === c.id);
              return (
                <div
                  key={c.id}
                  data-code={c.id}
                  className="card"
                  onClick={() => pickCode(c.id)}
                  style={{
                    gap: 6,
                    cursor: "pointer",
                    outline: on ? "2px solid var(--color-accent)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {merging && merging.keepId !== c.id && (
                      <input
                        type="checkbox"
                        checked={merging.ids.has(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setMerging((m) => {
                            if (!m) return m;
                            const ids = new Set(m.ids);
                            if (ids.has(c.id)) ids.delete(c.id);
                            else ids.add(c.id);
                            return { ...m, ids };
                          })
                        }
                        aria-label={`Fold ${c.ref} in`}
                      />
                    )}
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
                      {c.ref}
                    </span>
                    <span className="tag tag-neutral">{c.type}</span>
                    <span className="mono meta" style={{ fontSize: 11 }}>
                      {addr(c)}
                    </span>
                    <span className="meta" style={{ fontSize: 11, marginLeft: "auto" }}>
                      {c.origin === "claude" ? "Claude" : "person"}
                    </span>
                  </div>
                  <strong style={{ fontSize: 14 }}>{c.label}</strong>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>“{c.verbatim}”</p>
                  {c.note && (
                    <span className="meta" style={{ fontSize: 12 }}>
                      {c.note}
                    </span>
                  )}
                  {folded.length > 0 && (
                    <span className="meta" style={{ fontSize: 11.5 }}>
                      Merged in: {folded.map((f) => f.ref).join(", ")}
                    </span>
                  )}
                  {c.lastEdit && (
                    <span className="meta" style={{ fontSize: 11 }}>
                      Edited by {c.lastEdit.by} · {c.lastEdit.text}
                    </span>
                  )}
                  {editor && !merging && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost"
                        style={small}
                        onClick={() =>
                          setEditorSeed({
                            title: `Edit ${c.ref}`,
                            seed: { codeId: c.id, type: c.type, label: c.label, note: c.note ?? "", verbatim: c.verbatim, line_start: c.line_start, line_end: c.line_end },
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={small}
                        title="Make a second code from part of this one"
                        onClick={() =>
                          setEditorSeed({
                            title: `Split ${c.ref}: the new code`,
                            seed: { type: c.type, label: "", note: "", verbatim: c.verbatim, line_start: c.line_start, line_end: c.line_end },
                          })
                        }
                      >
                        Split
                      </button>
                      <button className="btn btn-ghost" style={small} onClick={() => setMerging({ keepId: c.id, ids: new Set() })}>
                        Merge into this…
                      </button>
                      {c.lastEdit && (
                        <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "revert", codeId: c.id }, `Reverted: ${c.lastEdit!.text}`)}>
                          Revert
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        style={{ ...small, marginLeft: "auto" }}
                        disabled={busy}
                        onClick={() => (confirming === c.id ? act({ action: "delete", codeId: c.id }, `Deleted ${c.ref}.`) : setConfirming(c.id))}
                      >
                        {confirming === c.id ? "Delete?" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {selection && (
        <button
          className="btn btn-primary"
          style={{ position: "fixed", zIndex: 40, left: selection.x, top: selection.y - 40, transform: "translateX(-50%)", fontSize: 12 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setEditorSeed({ title: "New code", seed: selection.seed });
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Code this
        </button>
      )}

      {editorSeed && (
        <CodeEditor
          title={editorSeed.title}
          seed={editorSeed.seed}
          transcriptId={transcriptId}
          lines={lines}
          onClose={() => setEditorSeed(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
