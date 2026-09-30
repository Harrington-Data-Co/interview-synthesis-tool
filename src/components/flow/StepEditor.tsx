"use client";

import { useState } from "react";
import { Dialog, Field, Notice } from "@/components/ui";
import type { EvidenceCode, EvidenceInterview } from "@/lib/themes/evidence";
import { flowAction } from "./actions";

export type StepSeed = {
  stepId?: string;
  rejectionId?: string;
  laneId: string;
  position: number;
  /** For a new step: open a new position there (true), or take the free slot. */
  insert: boolean;
  label: string;
  kind: "task" | "wait" | "decision";
  note: string;
  codeIds: string[];
};

const KINDS: [StepSeed["kind"], string, string][] = [
  ["task", "Task", "Someone does something"],
  ["wait", "Wait", "The work stops for someone or something"],
  ["decision", "Decision", "A choice that sends the work different ways"],
];
const FLOW_TYPES = ["Step", "Tool", "Stakeholder", "Pain", "Constraint"];

/** Add or edit a step: what happens, who does it (lane), where in the
 *  sequence, its kind, and the codes it rests on (at least one). */
export function StepEditor({
  title,
  seed,
  flowId,
  lanes,
  interviews,
  codes,
  onClose,
  onSaved,
}: {
  title: string;
  seed: StepSeed;
  flowId: string;
  lanes: { id: string; name: string }[];
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(seed.label);
  const [kind, setKind] = useState(seed.kind);
  const [laneId, setLaneId] = useState(seed.laneId);
  const [position, setPosition] = useState(seed.position);
  const [note, setNote] = useState(seed.note);
  const [picked, setPicked] = useState<Set<string>>(new Set(seed.codeIds));
  const [interview, setInterview] = useState("");
  const [allTypes, setAllTypes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const shown = codes.filter(
    (c) => picked.has(c.id) || ((!interview || c.transcriptId === interview) && (allTypes || FLOW_TYPES.includes(c.type))),
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
    const { error: err } = seed.stepId
      ? await flowAction(flowId, { action: "stepUpdate", stepId: seed.stepId, changes: { label, kind, note, laneId, position, codeIds } })
      : await flowAction(flowId, { action: "stepCreate", laneId, position, insert: seed.insert, label, kind, note, codeIds, rejectionId: seed.rejectionId });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
    onClose();
  }

  const row = { display: "grid", gridTemplateColumns: "18px auto 1fr", gap: 8, padding: "5px 12px", alignItems: "start", cursor: "pointer" } as const;

  return (
    <Dialog title={title} onClose={busy ? undefined : onClose} width={760}>
      <Field label="Step" hint="A short verb phrase, as participants described it.">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "var(--space-3)" }}>
        <Field label="Lane">
          <select className="input" value={laneId} onChange={(e) => setLaneId(e.target.value)}>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position">
          <input className="input" type="number" min={1} value={position} onChange={(e) => setPosition(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
      </div>
      <div className="seg" role="radiogroup" aria-label="Kind" style={{ alignSelf: "flex-start" }}>
        {KINDS.map(([k, name, hint]) => (
          <label key={k} className="seg-opt" title={hint}>
            <input type="radio" name="step-kind" checked={kind === k} onChange={() => setKind(k)} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
            <span>{name}</span>
          </label>
        ))}
      </div>
      <Field label="Note" hint="Optional: where accounts differ, or what the step depends on.">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={{ resize: "vertical" }} />
      </Field>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="kicker" style={{ fontSize: 10 }}>
          Codes · {picked.size}
        </span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, marginLeft: "auto" }}>
          <input type="checkbox" checked={allTypes} onChange={(e) => setAllTypes(e.target.checked)} />
          Every code type
        </label>
        <select className="input" value={interview} onChange={(e) => setInterview(e.target.value)} style={{ width: "auto", fontSize: 12 }}>
          <option value="">All interviews</option>
          {interviews.map((i) => (
            <option key={i.id} value={i.id}>
              {i.key} · {i.participant ?? i.title}
            </option>
          ))}
        </select>
      </div>
      <div className="panel" style={{ maxHeight: 260, overflow: "auto", padding: "4px 0" }}>
        {!shown.length && (
          <span className="meta" style={{ fontSize: 12, padding: "5px 12px", display: "block" }}>
            No codes to show.
          </span>
        )}
        {shown.map((c) => (
          <label key={c.id} style={row}>
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              {c.key}
            </span>
            <span style={{ fontSize: 12.5 }}>
              {c.label}{" "}
              <span className="meta" style={{ fontSize: 11 }}>
                {c.type} · “{c.verbatim.length > 90 ? `${c.verbatim.slice(0, 90)}…` : c.verbatim}”
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
        <button className="btn btn-primary" onClick={save} disabled={busy || !label.trim() || !picked.size || !laneId}>
          {busy ? "Saving…" : seed.stepId ? "Save changes" : "Add step"}
        </button>
      </div>
    </Dialog>
  );
}
