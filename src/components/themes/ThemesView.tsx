"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";
import { ThemeEditor, type ThemeSeed } from "./ThemeEditor";
import {
  themeAction,
  type EvidenceCode,
  type EvidenceInterview,
  type ThemeRejectionView,
  type ThemeRunView,
  type ThemeView,
} from "./types";

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
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  const weight = (t: ThemeView) => {
    const cs = t.codeIds.map((id) => byId.get(id)).filter((c): c is EvidenceCode => !!c);
    return { codes: cs, ivs: new Set(cs.map((c) => c.transcriptId)).size };
  };

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
      {text} <span className="mono" style={{ opacity: 0.7 }}>{n}</span>
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
        <div className="panel" style={{ padding: "var(--space-2) var(--space-3)", display: "flex", gap: "var(--space-2)", alignItems: "center", background: "var(--color-navy)", color: "#FFFFFF" }}>
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
            const expanded = open.has(t.id);
            return (
              <div key={t.id} className="card" style={{ gap: 8, borderLeft: `3px solid ${t.status === "confirmed" ? "var(--color-accent)" : "var(--line-3)"}` }}>
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
                  {(expanded ? w.codes : w.codes.slice(0, PREVIEW)).map((c) => (
                    <span key={c.id} className="tag tag-neutral" title={c.label} style={{ fontSize: 10.5 }}>
                      {c.key}
                    </span>
                  ))}
                  <button type="button" className="meta" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 11.5 }}>
                    {expanded ? "Hide quotes" : w.codes.length > PREVIEW ? `+${w.codes.length - PREVIEW} more · show quotes` : "Show quotes"}
                  </button>
                </div>
                {expanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--line-1)", paddingTop: 6 }}>
                    {w.codes.map((c) => (
                      <div key={c.id} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                        <Link href={`/transcripts/${c.transcriptId}?stage=coding`} className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
                          {c.key}
                        </Link>{" "}
                        <span className="meta" style={{ fontSize: 11 }}>
                          {ivById.get(c.transcriptId)?.participant ?? ""}
                        </span>{" "}
                        <em>“{c.verbatim}”</em>
                      </div>
                    ))}
                  </div>
                )}
                {t.lastEdit && (
                  <span className="meta" style={{ fontSize: 11 }}>
                    Edited by {t.lastEdit.by} · {t.lastEdit.text}
                  </span>
                )}
                {editor && !merging && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button className={t.status === "confirmed" ? "btn btn-ghost" : "btn btn-secondary"} style={small} disabled={busy} onClick={() => act({ action: "confirm", themeId: t.id, confirmed: t.status !== "confirmed" })}>
                      {t.status === "confirmed" ? "Un-confirm" : "Confirm"}
                    </button>
                    <button className="btn btn-ghost" style={small} onClick={() => setSeed({ mode: "edit", themeId: t.id, title: t.title, description: t.description ?? "", codeIds: t.codeIds })}>
                      Edit
                    </button>
                    <button className="btn btn-ghost" style={small} disabled={t.codeIds.length < 2} onClick={() => setSeed({ mode: "split", themeId: t.id, title: t.ref, codeIds: t.codeIds })}>
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

        <aside style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="card" style={{ gap: 6 }}>
            <span className="card-kicker">Source ledger · {interviews.length} coded interview{interviews.length === 1 ? "" : "s"}</span>
            {interviews.map((iv) => (
              <div key={iv.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 8, alignItems: "baseline", fontSize: 12.5 }}>
                <span className="mono meta">{iv.key}</span>
                <Link href={`/transcripts/${iv.id}?stage=coding`} style={{ minWidth: 0 }}>
                  {iv.participant ?? iv.title}
                  {iv.organization && (
                    <span className="meta" style={{ display: "block", fontSize: 11 }}>
                      {iv.organization}
                    </span>
                  )}
                </Link>
                <span className="mono meta" style={{ fontSize: 11 }}>
                  {iv.codeCount}
                </span>
              </div>
            ))}
          </div>

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
      </div>

      {seed && (
        <ThemeEditor
          seed={seed}
          projectId={projectId}
          interviews={interviews}
          codes={codes}
          onClose={() => setSeed(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
