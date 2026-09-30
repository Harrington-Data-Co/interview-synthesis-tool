"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EvidenceDrawer } from "@/components/evidence/EvidenceDrawer";
import { Notice } from "@/components/ui";
import { ThemeEditor, type ThemeSeed } from "./ThemeEditor";
import { themeAction, type EvidenceCode, type EvidenceInterview, type ThemeRejectionView, type ThemeRunView, type ThemeView } from "./types";

const PREVIEW = 10;

/** Stage 04, first half: themes across the project's interviews. Claude
 *  proposes; a person confirms, edits, merges, splits or deletes. Only
 *  confirmed themes feed the memo. */
export function ThemesView({
  projectId,
  editor,
  interviews,
  codes,
  themes,
  rejections,
  runs,
}: {
  projectId: string;
  editor: boolean;
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  themes: ThemeView[];
  rejections: ThemeRejectionView[];
  runs: ThemeRunView[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"" | "proposed" | "confirmed">("");
  // The theme whose quotes are open in the drawer.
  const [open, setOpen] = useState<string | null>(null);
  const [seed, setSeed] = useState<ThemeSeed | null>(null);
  const [merging, setMerging] = useState<{ keepId: string; ids: Set<string> } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const byId = new Map(codes.map((c) => [c.id, c]));
  const ivById = new Map(interviews.map((i) => [i.id, i]));
  const proposed = themes.filter((t) => t.status === "proposed");
  const confirmed = themes.filter((t) => t.status === "confirmed");
  const shown = themes.filter((t) => !filter || t.status === filter);
  const lastRun = runs[0];
  const small = { fontSize: 11.5, padding: "2px 8px" } as const;

  const order = new Map(interviews.map((iv, i) => [iv.id, i]));
  const weight = (t: ThemeView) => {
    const cs = t.codeIds
      .map((id) => byId.get(id))
      .filter((c): c is EvidenceCode => !!c)
      .sort((a, b) => (order.get(a.transcriptId) ?? 0) - (order.get(b.transcriptId) ?? 0) || a.line_start - b.line_start);
    return { codes: cs, ivs: new Set(cs.map((c) => c.transcriptId)).size };
  };
  const openTheme = themes.find((t) => t.id === open);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    setNotice(null);
    const { error } = await themeAction(projectId, body);
    setBusy(false);
    setConfirming(null);
    if (error) return setNotice({ tone: "error", text: error });
    if (done) setNotice({ tone: "info", text: done });
    router.refresh();
  }

  async function propose() {
    setRunning(true);
    setNotice(null);
    setConfirming(null);
    const res = await fetch(`/api/projects/${projectId}/themes/propose`, { method: "POST" });
    const b = await res.json().catch(() => ({}));
    setRunning(false);
    if (!res.ok) setNotice({ tone: "error", text: b.error ?? `Proposing themes failed (${res.status}).` });
    else {
      const cost = typeof b.costUsd === "number" ? ` · $${b.costUsd.toFixed(2)}` : "";
      setNotice({ tone: "info", text: `Proposed ${b.accepted} themes${b.rejected ? `, ${b.rejected} notes for review` : ""}${cost}. Confirm the ones that hold.` });
    }
    router.refresh();
  }

  const pill = (value: typeof filter, text: string, n: number) => (
    <button
      key={value || "all"}
      className="btn"
      onClick={() => setFilter(value)}
      style={{
        fontSize: 12,
        padding: "3px 10px",
        background: filter === value ? "var(--color-accent-tint)" : "transparent",
        color: filter === value ? "var(--color-accent-800)" : "var(--color-text)",
        fontWeight: filter === value ? 700 : 500,
      }}
    >
      {text}{" "}
      <span className="mono" style={{ opacity: 0.7 }}>
        {n}
      </span>
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        {pill("", "All", themes.length)}
        {pill("proposed", "Proposed", proposed.length)}
        {pill("confirmed", "Confirmed", confirmed.length)}
        {editor && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {lastRun && !running && (
              <span className="meta" style={{ fontSize: 11.5 }}>
                Last proposed {new Date(lastRun.started_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} by {lastRun.started_by}
                {lastRun.status === "done" && lastRun.cost_usd !== null && ` · $${Number(lastRun.cost_usd).toFixed(2)}`}
                {lastRun.status === "failed" && ` · failed: ${lastRun.error}`}
              </span>
            )}
            <button className="btn btn-ghost" disabled={busy || running} onClick={() => setSeed({ mode: "create", title: "", description: "", codeIds: [] })}>
              + New theme
            </button>
            {running ? (
              <span className="btn" role="status" style={{ cursor: "default", fontWeight: 500 }}>
                Proposing themes…
              </span>
            ) : !proposed.some((t) => t.origin === "claude") ? (
              <button className="btn btn-primary" disabled={busy || !codes.length} onClick={propose}>
                Propose themes
              </button>
            ) : (
              <button className="btn btn-secondary" disabled={busy} onClick={() => (confirming === "repropose" ? propose() : setConfirming("repropose"))}>
                {confirming === "repropose" ? "Replace unconfirmed proposals? Confirmed themes stay." : "Re-propose"}
              </button>
            )}
          </span>
        )}
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {merging && (
        <div
          className="panel"
          style={{ padding: "var(--space-2) var(--space-3)", display: "flex", gap: "var(--space-2)", alignItems: "center", background: "var(--color-navy)", color: "#FFFFFF" }}
        >
          <span style={{ fontSize: 12.5 }}>
            Tick the themes to fold into <strong>{themes.find((t) => t.id === merging.keepId)?.ref}</strong>
          </span>
          <button
            className="btn"
            style={{ fontSize: 12, color: "#FFFFFF", borderColor: "rgba(242,242,243,.45)", marginLeft: "auto" }}
            disabled={busy || !merging.ids.size}
            onClick={() => act({ action: "merge", keepId: merging.keepId, mergeIds: [...merging.ids] }, "Merged.").then(() => setMerging(null))}
          >
            Merge {merging.ids.size || ""}
          </button>
          <button className="btn" style={{ fontSize: 12, color: "#FFFFFF", borderColor: "rgba(242,242,243,.25)" }} onClick={() => setMerging(null)}>
            Cancel
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)", alignItems: "flex-start" }}>
        <section style={{ flex: "2 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {!themes.length && (
            <div className="panel" style={{ padding: "var(--space-4)" }}>
              <p className="meta" style={{ margin: 0 }}>
                {codes.length
                  ? editor
                    ? "No themes yet. Propose themes from the coded interviews, or create one yourself."
                    : "No themes yet."
                  : "Code this project's interviews first; themes are drawn from their codes."}
              </p>
            </div>
          )}
          {shown.map((t) => {
            const w = weight(t);
            const picked = open === t.id;
            return (
              <div
                key={t.id}
                className="card"
                title="Show this theme's quotes"
                // The card's own buttons and inputs do their own thing.
                onClick={(e) => !(e.target as Element).closest("button, a, input, label") && setOpen(picked ? null : t.id)}
                style={{
                  gap: 8,
                  cursor: "pointer",
                  borderLeft: `3px solid ${t.status === "confirmed" ? "var(--color-accent)" : "var(--line-3)"}`,
                  boxShadow: picked ? "0 0 0 2px var(--color-accent-400)" : undefined,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {merging && merging.keepId !== t.id && (
                    <input
                      type="checkbox"
                      checked={merging.ids.has(t.id)}
                      disabled={t.citedByMemo}
                      title={t.citedByMemo ? "The memo cites this theme" : undefined}
                      onChange={() =>
                        setMerging((m) => {
                          if (!m) return m;
                          const ids = new Set(m.ids);
                          if (ids.has(t.id)) ids.delete(t.id);
                          else ids.add(t.id);
                          return { ...m, ids };
                        })
                      }
                      aria-label={`Fold ${t.ref} in`}
                    />
                  )}
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
                    {t.ref}
                  </span>
                  <span className={`tag ${t.status === "confirmed" ? "tag-accent" : "tag-outline"}`}>{t.status === "confirmed" ? "Confirmed" : "Proposed"}</span>
                  <span className="mono meta" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                    {w.codes.length} codes · {w.ivs} of {interviews.length} interviews
                  </span>
                </div>
                <strong style={{ fontSize: 15, lineHeight: 1.35 }}>{t.title}</strong>
                {t.description && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{t.description}</p>}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  {w.codes.slice(0, PREVIEW).map((c) => (
                    <span key={c.id} className="tag tag-neutral" title={c.label} style={{ fontSize: 10.5 }}>
                      {c.key}
                    </span>
                  ))}
                  {w.codes.length > PREVIEW && (
                    <span className="meta" style={{ fontSize: 11.5 }}>
                      +{w.codes.length - PREVIEW} more
                    </span>
                  )}
                  <button type="button" className="meta" onClick={() => setOpen(picked ? null : t.id)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 11.5 }}>
                    {picked ? "Hide quotes" : "Show quotes"}
                  </button>
                </div>
                {t.lastEdit && (
                  <span className="meta" style={{ fontSize: 11 }}>
                    Edited by {t.lastEdit.by} · {t.lastEdit.text}
                  </span>
                )}
                {editor && !merging && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button
                      className={t.status === "confirmed" ? "btn btn-ghost" : "btn btn-secondary"}
                      style={small}
                      disabled={busy}
                      onClick={() => act({ action: "confirm", themeId: t.id, confirmed: t.status !== "confirmed" })}
                    >
                      {t.status === "confirmed" ? "Un-confirm" : "Confirm"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={small}
                      onClick={() => setSeed({ mode: "edit", themeId: t.id, title: t.title, description: t.description ?? "", codeIds: t.codeIds })}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={small}
                      disabled={t.codeIds.length < 2}
                      onClick={() => setSeed({ mode: "split", themeId: t.id, title: t.ref, codeIds: t.codeIds })}
                    >
                      Split
                    </button>
                    <button className="btn btn-ghost" style={small} onClick={() => setMerging({ keepId: t.id, ids: new Set() })}>
                      Merge into this…
                    </button>
                    {t.lastEdit && (
                      <button className="btn btn-ghost" style={small} disabled={busy} onClick={() => act({ action: "revert", themeId: t.id }, `Reverted: ${t.lastEdit!.text}`)}>
                        Revert
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ ...small, marginLeft: "auto" }}
                      disabled={busy || t.citedByMemo}
                      title={t.citedByMemo ? "The memo cites this theme; edit the memo first" : undefined}
                      onClick={() => (confirming === t.id ? act({ action: "delete", themeId: t.id }, `Deleted ${t.ref}.`) : setConfirming(t.id))}
                    >
                      {confirming === t.id ? "Delete?" : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {rejections.length > 0 && (
          <aside style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {rejections.length > 0 && (
              <div className="panel" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", background: "var(--color-accent-100)" }}>
                <strong style={{ fontSize: 13 }}>Needs review · {rejections.length}</strong>
                {rejections.map((r) => (
                  <div key={r.id} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                    {r.proposal.title && <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.proposal.title}</span>}
                    <span className="meta" style={{ fontSize: 11.5 }}>
                      {r.reason}
                    </span>
                    {editor && (
                      <span style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn btn-secondary"
                          style={small}
                          onClick={() =>
                            setSeed({
                              mode: "create",
                              rejectionId: r.id,
                              title: r.proposal.title ?? "",
                              description: r.proposal.description ?? "",
                              codeIds: (r.proposal.code_ids ?? codes.filter((c) => (r.proposal.codes ?? []).includes(c.key)).map((c) => c.id)).filter((id) => byId.has(id)),
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
          </aside>
        )}
      </div>

      {openTheme && (
        <EvidenceDrawer
          kicker={`${openTheme.ref} · ${openTheme.status === "confirmed" ? "Confirmed" : "Proposed"} theme`}
          title={openTheme.title}
          description={openTheme.description}
          sections={[
            {
              key: openTheme.id,
              quotes: weight(openTheme).codes.map((c) => ({
                id: c.id,
                transcriptId: c.transcriptId,
                ref: c.ref,
                type: c.type,
                label: c.label,
                verbatim: c.verbatim,
                start: c.line_start,
                end: c.line_end,
              })),
            },
          ]}
          interviews={ivById}
          onClose={() => setOpen(null)}
        />
      )}

      {seed && <ThemeEditor seed={seed} projectId={projectId} interviews={interviews} codes={codes} onClose={() => setSeed(null)} onSaved={() => router.refresh()} />}
    </div>
  );
}
