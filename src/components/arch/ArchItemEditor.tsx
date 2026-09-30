"use client";

import { useState } from "react";
import { Dialog, Field, Notice } from "@/components/ui";
import type { ArchMapView } from "@/lib/arch/load";
import { NODE_KINDS, type NodeKind } from "@/lib/arch/prompt";
import type { EvidenceCode, EvidenceInterview } from "@/lib/themes/evidence";
import { archAction } from "./actions";

export type ItemSeed =
  | { kind: "node"; itemId?: string; name: string; nodeKind: NodeKind; official: boolean; note: string; codeIds: string[]; rejectionId?: string }
  | { kind: "flow"; itemId?: string; fromNode: string; toNode: string; label: string; manual: boolean; note: string; codeIds: string[]; rejectionId?: string }
  | { kind: "gap"; itemId?: string; title: string; note: string; codeIds: string[]; rejectionId?: string };

const KIND_NAMES: Record<NodeKind, string> = {
  system: "System",
  spreadsheet: "Spreadsheet",
  document: "Document",
  communication: "Communication (email, chat, phone)",
  manual: "Manual (paper, memory, personal notes)",
  external: "Outside party's system",
};
const ARCH_TYPES = ["Tool", "Step", "Stakeholder", "Pain", "Constraint"];

/** Add or edit a system, a flow or a gap, and the codes it rests on. */
export function ArchItemEditor({
  seed,
  map,
  interviews,
  codes,
  onClose,
  onSaved,
}: {
  seed: ItemSeed;
  map: ArchMapView;
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [s, setS] = useState<ItemSeed>(seed);
  const [picked, setPicked] = useState<Set<string>>(new Set(seed.codeIds));
  const [interview, setInterview] = useState("");
  const [allTypes, setAllTypes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<ItemSeed>) => setS((cur) => ({ ...cur, ...patch }) as ItemSeed);

  const shown = codes.filter((c) => picked.has(c.id) || ((!interview || c.transcriptId === interview) && (allTypes || ARCH_TYPES.includes(c.type))));
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ready =
    picked.size > 0 &&
    (s.kind === "node" ? !!s.name.trim() : s.kind === "flow" ? !!s.label.trim() && !!s.fromNode && !!s.toNode && s.fromNode !== s.toNode : !!s.title.trim());

  async function save() {
    setBusy(true);
    setError("");
    const codeIds = [...picked];
    const fields =
      s.kind === "node"
        ? { name: s.name, kind: s.nodeKind, official: s.official, note: s.note, codeIds }
        : s.kind === "flow"
          ? { fromNode: s.fromNode, toNode: s.toNode, label: s.label, manual: s.manual, note: s.note, codeIds }
          : { title: s.title, note: s.note, codeIds };
    const { error: err } = await archAction(map.id, { action: "save", kind: s.kind, itemId: s.itemId, fields, rejectionId: s.rejectionId });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
    onClose();
  }

  const what = s.kind === "node" ? "system" : s.kind;
  const row = { display: "grid", gridTemplateColumns: "18px auto 1fr", gap: 8, padding: "5px 12px", alignItems: "start", cursor: "pointer" } as const;

  return (
    <Dialog title={`${s.itemId ? "Edit" : "Add"} ${what}`} onClose={busy ? undefined : onClose} width={760}>
      {s.kind === "node" && (
        <>
          <Field label="Name" hint="As participants call it.">
            <input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-3)", alignItems: "end" }}>
            <Field label="Kind">
              <select className="input" value={s.nodeKind} onChange={(e) => set({ nodeKind: e.target.value as NodeKind })}>
                {NODE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_NAMES[k]}
                  </option>
                ))}
              </select>
            </Field>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, paddingBottom: 8 }}>
              <input type="checkbox" checked={!s.official} onChange={(e) => set({ official: !e.target.checked })} />
              A workaround people built
            </label>
          </div>
        </>
      )}
      {s.kind === "flow" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <Field label="From">
              <select className="input" value={s.fromNode} onChange={(e) => set({ fromNode: e.target.value })}>
                {map.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To">
              <select className="input" value={s.toNode} onChange={(e) => set({ toNode: e.target.value })}>
                {map.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="What moves" hint="For example “Award totals” or “Site visit notes”.">
            <input className="input" value={s.label} onChange={(e) => set({ label: e.target.value })} autoFocus />
          </Field>
          <div className="seg" role="radiogroup" aria-label="How it moves" style={{ alignSelf: "flex-start" }}>
            {([true, false] as const).map((m) => (
              <label key={String(m)} className="seg-opt">
                <input type="radio" name="flow-manual" checked={s.manual === m} onChange={() => set({ manual: m })} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
                <span>{m ? "A person moves it" : "The systems move it"}</span>
              </label>
            ))}
          </div>
        </>
      )}
      {s.kind === "gap" && (
        <Field label="Gap" hint="A short title: a missing connection, duplicated data, something nobody owns.">
          <input className="input" value={s.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
        </Field>
      )}
      <Field label="Note">
        <textarea className="input" rows={2} value={s.note} onChange={(e) => set({ note: e.target.value })} style={{ resize: "vertical" }} />
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
      <div className="panel" style={{ maxHeight: 240, overflow: "auto", padding: "4px 0" }}>
        {shown.map((c) => (
          <label key={c.id} style={row}>
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
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
        <button className="btn btn-primary" onClick={save} disabled={busy || !ready}>
          {busy ? "Saving…" : s.itemId ? "Save changes" : `Add ${what}`}
        </button>
      </div>
    </Dialog>
  );
}
