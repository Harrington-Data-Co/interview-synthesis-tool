"use client";

import { useMemo, useState } from "react";
import { Dialog, Field, Notice } from "@/components/ui";
import { quoteFits } from "@/lib/coding/gate";
import { codeAction, CODE_TYPES, type CodeType, type LineRow } from "./types";

export type EditorSeed = {
  /** Editing an existing code; absent when creating. */
  codeId?: string;
  /** Creating from one of Claude's rejected proposals. */
  rejectionId?: string;
  type: CodeType;
  label: string;
  note: string;
  verbatim: string;
  line_start: number;
  line_end: number;
};

/** Create or edit a code. The quote is checked as it's typed against the
 *  lines it cites, with the database's own rule, so a code that can't be
 *  saved says why before Save is pressed. */
export function CodeEditor({
  title,
  seed,
  transcriptId,
  lines,
  onClose,
  onSaved,
}: {
  title: string;
  seed: EditorSeed;
  transcriptId: string;
  lines: LineRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<CodeType>(seed.type);
  const [label, setLabel] = useState(seed.label);
  const [note, setNote] = useState(seed.note);
  const [verbatim, setVerbatim] = useState(seed.verbatim);
  const [start, setStart] = useState(seed.line_start);
  const [end, setEnd] = useState(seed.line_end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const byN = useMemo(() => new Map(lines.map((l) => [l.n, { ...l, speaker: l.speaker, displayName: null }])), [lines]);
  const quote = verbatim.replace(/\s+/g, " ").trim();
  const rangeOk = byN.has(start) && byN.has(end) && start <= end;
  const fits = rangeOk && !!quote && quoteFits(byN, start, end, quote);
  const range = rangeOk ? lines.filter((l) => l.n >= start && l.n <= end) : [];
  const hasInterviewer = range.some((l) => l.role === "interviewer");

  async function save() {
    setBusy(true);
    setError("");
    const fields = { type, label, note, verbatim: quote, line_start: start, line_end: end };
    const { error: err } = seed.codeId
      ? await codeAction(transcriptId, { action: "update", codeId: seed.codeId, changes: fields })
      : await codeAction(transcriptId, { action: "create", ...fields, rejectionId: seed.rejectionId });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
    onClose();
  }

  return (
    <Dialog title={title} onClose={busy ? undefined : onClose} width={720}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "var(--space-3)" }}>
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as CodeType)}>
            {CODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From line">
          <input className="input mono" type="number" min={1} value={start} onChange={(e) => setStart(Number(e.target.value))} />
        </Field>
        <Field label="To line">
          <input className="input mono" type="number" min={1} value={end} onChange={(e) => setEnd(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Label" hint="The finding, in your words — short and specific.">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={!seed.label} />
      </Field>
      <Field label="Quote" hint="Word for word from these lines. It must start in the first and end in the last.">
        <textarea
          className="input"
          rows={3}
          value={verbatim}
          onChange={(e) => setVerbatim(e.target.value)}
          style={{ resize: "vertical" }}
        />
      </Field>
      <span style={{ fontSize: 12, color: fits ? "var(--color-accent-800)" : "var(--color-navy)", fontWeight: fits ? 400 : 700 }}>
        {!rangeOk
          ? "Those lines don't exist."
          : fits
            ? "✓ Word for word in these lines."
            : "✗ Not word for word in these lines, or the range is wider than the quote."}
      </span>
      {range.length > 0 && (
        <div className="panel" style={{ padding: "var(--space-2) var(--space-3)", maxHeight: 160, overflow: "auto", fontSize: 12.5, lineHeight: 1.55 }}>
          {range.map((l) => (
            <div key={l.n}>
              <span className="mono meta" style={{ fontSize: 10.5 }}>
                L{l.n}
              </span>{" "}
              <strong style={{ fontSize: 11.5 }}>{l.speaker}</strong>
              {l.role === "interviewer" && <span className="meta"> (interviewer)</span>}: {l.text}
            </div>
          ))}
        </div>
      )}
      {hasInterviewer && (
        <p className="meta" style={{ margin: 0, fontSize: 12 }}>
          This quotes an interviewer. People may code interviewer lines; Claude never does.
        </p>
      )}
      <Field label="Note" hint="Optional: context that makes the code make sense on its own.">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !fits || !label.trim()}>
          {busy ? "Saving…" : seed.codeId ? "Save changes" : "Save code"}
        </button>
      </div>
    </Dialog>
  );
}
