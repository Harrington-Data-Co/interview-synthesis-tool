"use client";

import { useState } from "react";
import { Dialog, Field, Notice } from "@/components/ui";
import { addr, itemAction, type NoteCodeView, type NoteSectionView } from "./types";

export type ItemSeed = {
  itemId?: string;
  rejectionId?: string;
  sectionId: string;
  text: string;
  codeIds: string[];
};

/** Write or edit a note item: its section, its sentence, and the codes it
 *  rests on. People may cite any of the interview's codes in any section. */
export function ItemEditor({
  title,
  seed,
  noteId,
  sections,
  codes,
  onClose,
  onSaved,
}: {
  title: string;
  seed: ItemSeed;
  noteId: string;
  sections: NoteSectionView[];
  codes: NoteCodeView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sectionId, setSectionId] = useState(seed.sectionId);
  const [text, setText] = useState(seed.text);
  const [picked, setPicked] = useState<Set<string>>(new Set(seed.codeIds));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const byId = new Map(codes.map((c) => [c.id, c]));
  // Active codes can be cited; a merged one stays listed only if already cited.
  const listed = codes.filter((c) => !c.merged_into_id || seed.codeIds.includes(c.id));
  const types = [...new Set(listed.map((c) => c.type))];
  const shown = listed.filter((c) => !filter || c.type === filter || picked.has(c.id));
  const section = sections.find((s) => s.id === sectionId);

  async function save() {
    setBusy(true);
    setError("");
    const codeIds = [...picked];
    const { error: err } = seed.itemId
      ? await itemAction(noteId, { action: "update", itemId: seed.itemId, changes: { text, sectionId, codeIds } })
      : await itemAction(noteId, { action: "create", sectionId, text, codeIds, rejectionId: seed.rejectionId });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
    onClose();
  }

  return (
    <Dialog title={title} onClose={busy ? undefined : onClose} width={760}>
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
      <Field label="Item" hint="One or two sentences restating what the cited codes say — no new claims.">
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} style={{ resize: "vertical" }} autoFocus />
      </Field>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="kicker" style={{ fontSize: 10 }}>
          Cites · {picked.size} code{picked.size === 1 ? "" : "s"}
        </span>
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto", fontSize: 12, marginLeft: "auto" }}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="panel" style={{ maxHeight: 260, overflow: "auto", padding: "4px 0" }}>
        {shown.map((c) => (
          <label key={c.id} style={{ display: "grid", gridTemplateColumns: "18px auto 1fr", gap: 8, padding: "5px 12px", alignItems: "start", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              onChange={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  if (n.has(c.id)) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                })
              }
            />
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              {c.ref}
            </span>
            <span style={{ fontSize: 12.5 }}>
              {c.label}{" "}
              <span className="meta" style={{ fontSize: 11 }}>
                {c.type} · {addr(c)}
                {c.merged_into_id ? ` · merged into ${byId.get(c.merged_into_id)?.ref ?? "another code"}` : ""}
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
        <button className="btn btn-primary" onClick={save} disabled={busy || !text.trim() || picked.size === 0}>
          {busy ? "Saving…" : seed.itemId ? "Save changes" : "Add item"}
        </button>
      </div>
    </Dialog>
  );
}
