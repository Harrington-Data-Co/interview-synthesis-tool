"use client";

import { useState } from "react";
import { Dialog, Field, Notice } from "@/components/ui";
import type { MemoTemplateView, MemoThemeView } from "@/lib/memo/load";
import type { EvidenceCode, EvidenceInterview } from "@/lib/themes/evidence";
import { memoAction } from "./types";

export type ParagraphSeed = {
  itemId?: string;
  rejectionId?: string;
  sectionId: string;
  text: string;
  themeIds: string[];
  codeIds: string[];
};

/** Write or edit a memo paragraph: its section, its text, and the themes and
 *  codes it rests on. People may cite any theme or code in the project;
 *  Claude is held to confirmed themes and the section's types. */
export function ParagraphEditor({
  title,
  seed,
  productId,
  sections,
  themes,
  interviews,
  codes,
  onClose,
  onSaved,
}: {
  title: string;
  seed: ParagraphSeed;
  productId: string;
  sections: MemoTemplateView["sections"];
  themes: MemoThemeView[];
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sectionId, setSectionId] = useState(seed.sectionId);
  const [text, setText] = useState(seed.text);
  const [pickedThemes, setPickedThemes] = useState<Set<string>>(new Set(seed.themeIds));
  const [pickedCodes, setPickedCodes] = useState<Set<string>>(new Set(seed.codeIds));
  const [interview, setInterview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const section = sections.find((s) => s.id === sectionId);
  const toggle = (set: (f: (p: Set<string>) => Set<string>) => void, id: string) =>
    set((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const shownCodes = codes.filter((c) => (!interview || c.transcriptId === interview) || pickedCodes.has(c.id));
  const cites = pickedThemes.size + pickedCodes.size;

  async function save() {
    setBusy(true);
    setError("");
    const themeIds = [...pickedThemes];
    const codeIds = [...pickedCodes];
    const { error: err } = seed.itemId
      ? await memoAction(productId, { action: "update", itemId: seed.itemId, changes: { text, sectionId, themeIds, codeIds } })
      : await memoAction(productId, { action: "create", sectionId, text, themeIds, codeIds, rejectionId: seed.rejectionId });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
    onClose();
  }

  const row = { display: "grid", gridTemplateColumns: "18px auto 1fr", gap: 8, padding: "5px 12px", alignItems: "start", cursor: "pointer" } as const;

  return (
    <Dialog title={title} onClose={busy ? undefined : onClose} width={780}>
      <Field label="Section">
        <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {section?.note && (
        <span className="meta" style={{ fontSize: 12, marginTop: -8 }}>
          {section.note}
        </span>
      )}
      <Field label="Paragraph" hint="Say only what the cited themes and codes support.">
        <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} style={{ resize: "vertical" }} autoFocus />
      </Field>

      <span className="kicker" style={{ fontSize: 10 }}>
        Themes · {pickedThemes.size}
      </span>
      <div className="panel" style={{ maxHeight: 160, overflow: "auto", padding: "4px 0" }}>
        {!themes.length && (
          <span className="meta" style={{ fontSize: 12, padding: "5px 12px", display: "block" }}>
            No themes in this project yet.
          </span>
        )}
        {themes.map((t) => (
          <label key={t.id} style={row}>
            <input type="checkbox" checked={pickedThemes.has(t.id)} onChange={() => toggle(setPickedThemes, t.id)} />
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              {t.ref}
            </span>
            <span style={{ fontSize: 12.5 }}>
              {t.title}{" "}
              <span className="meta" style={{ fontSize: 11 }}>
                {t.codeIds.length} codes{t.status === "proposed" ? " · not confirmed" : ""}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="kicker" style={{ fontSize: 10 }}>
          Codes · {pickedCodes.size}
        </span>
        <select className="input" value={interview} onChange={(e) => setInterview(e.target.value)} style={{ width: "auto", fontSize: 12, marginLeft: "auto" }}>
          <option value="">All interviews</option>
          {interviews.map((i) => (
            <option key={i.id} value={i.id}>
              {i.key} · {i.participant ?? i.title}
            </option>
          ))}
        </select>
      </div>
      <div className="panel" style={{ maxHeight: 220, overflow: "auto", padding: "4px 0" }}>
        {shownCodes.map((c) => (
          <label key={c.id} style={row}>
            <input type="checkbox" checked={pickedCodes.has(c.id)} onChange={() => toggle(setPickedCodes, c.id)} />
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              {c.key}
            </span>
            <span style={{ fontSize: 12.5 }}>
              {c.label}{" "}
              <span className="meta" style={{ fontSize: 11 }}>
                {c.type}
              </span>
            </span>
          </label>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !text.trim() || cites === 0}>
          {busy ? "Saving…" : seed.itemId ? "Save changes" : "Add paragraph"}
        </button>
      </div>
    </Dialog>
  );
}
