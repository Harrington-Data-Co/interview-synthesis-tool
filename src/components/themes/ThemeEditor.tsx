"use client";

import { useState } from "react";
import { Dialog, Field, Notice } from "@/components/ui";
import { themeAction, type EvidenceCode, type EvidenceInterview } from "./types";

export type ThemeSeed =
  | { mode: "create"; title: string; description: string; codeIds: string[]; rejectionId?: string }
  | { mode: "edit"; themeId: string; title: string; description: string; codeIds: string[] }
  | { mode: "split"; themeId: string; title: string; codeIds: string[] }; // codeIds: the theme's codes, to choose from

/** Create, edit or split a theme: its finding, its description, and the codes
 *  across the project's interviews that support it. */
export function ThemeEditor({
  seed,
  projectId,
  interviews,
  codes,
  onClose,
  onSaved,
}: {
  seed: ThemeSeed;
  projectId: string;
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(seed.mode === "split" ? "" : seed.title);
  const [description, setDescription] = useState(seed.mode === "split" ? "" : seed.description);
  const [picked, setPicked] = useState<Set<string>>(new Set(seed.mode === "split" ? [] : seed.codeIds));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Splitting chooses among the theme's own codes; otherwise, all of them.
  const pool = seed.mode === "split" ? codes.filter((c) => seed.codeIds.includes(c.id)) : codes;
  const q = search.trim().toLowerCase();
  const shown = pool.filter(
    (c) => picked.has(c.id) || !q || `${c.key} ${c.type} ${c.label} ${c.verbatim}`.toLowerCase().includes(q),
  );
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function save() {
    setBusy(true);
    setError("");
    const codeIds = [...picked];
    const { error: err } =
      seed.mode === "create"
        ? await themeAction(projectId, { action: "create", title, description, codeIds, rejectionId: seed.rejectionId })
        : seed.mode === "edit"
          ? await themeAction(projectId, { action: "update", themeId: seed.themeId, changes: { title, description, codeIds } })
          : await themeAction(projectId, { action: "split", themeId: seed.themeId, codeIds, title });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
    onClose();
  }

  const heading =
    seed.mode === "create" ? "New theme" : seed.mode === "edit" ? "Edit theme" : `Split ${seed.title}`;
  const canSave =
    !!title.trim() && picked.size > 0 && (seed.mode !== "split" || picked.size < seed.codeIds.length);

  return (
    <Dialog title={heading} onClose={busy ? undefined : onClose} width={820}>
      {seed.mode === "split" && (
        <p className="meta" style={{ margin: 0 }}>
          Choose the codes that move to the new theme. The rest stay where they are; each theme keeps at least one.
        </p>
      )}
      <Field label={seed.mode === "split" ? "New theme's finding" : "Finding"} hint="A plain sentence a client could read on its own.">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      {seed.mode !== "split" && (
        <Field label="Description" hint="What the codes show, and where it holds.">
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: "vertical" }} />
        </Field>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="kicker" style={{ fontSize: 10 }}>
          {seed.mode === "split" ? "Moves" : "Supported by"} · {picked.size} code{picked.size === 1 ? "" : "s"}
        </span>
        <input className="input" placeholder="Search codes" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginLeft: "auto", width: 220, fontSize: 12.5 }} />
      </div>
      <div className="panel" style={{ maxHeight: 320, overflow: "auto", padding: "4px 0" }}>
        {interviews.map((iv) => {
          const mine = shown.filter((c) => c.transcriptId === iv.id);
          if (!mine.length) return null;
          return (
            <div key={iv.id}>
              <div className="kicker" style={{ fontSize: 10, padding: "6px 12px 2px" }}>
                {iv.key} · {iv.participant ?? iv.title}
              </div>
              {mine.map((c) => (
                <label key={c.id} style={{ display: "grid", gridTemplateColumns: "18px auto 1fr", gap: 8, padding: "4px 12px", cursor: "pointer", alignItems: "start" }}>
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
                    {c.ref}
                  </span>
                  <span style={{ fontSize: 12.5 }}>
                    {c.label} <span className="meta" style={{ fontSize: 11 }}>{c.type}</span>
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !canSave}>
          {busy ? "Saving…" : seed.mode === "split" ? "Split" : seed.mode === "edit" ? "Save changes" : "Create theme"}
        </button>
      </div>
    </Dialog>
  );
}
