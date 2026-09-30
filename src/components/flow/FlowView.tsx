"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, Field, Notice } from "@/components/ui";
import type { LoadedFlows } from "@/lib/flow/load";
import { flowAction, projectFlows } from "./actions";
import { StepEditor, type StepSeed } from "./StepEditor";
import { PAIN, Swimlane, isPain } from "./Swimlane";

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
const money = (n: number | null) => (n === null ? "cost unknown" : `$${n.toFixed(2)}`);

/** Deliverable: current-state process maps, one swimlane each. Claude drafts
 *  them from the project's codes; people edit steps and lanes; every step
 *  opens onto the quotes it rests on. */
export function FlowView({ projectId, editor, data, mapId }: { projectId: string; editor: boolean; data: LoadedFlows; mapId: string | undefined }) {
  const router = useRouter();
  const { flows, codes, interviews, rejections, runs } = data;
  const flow = flows.find((f) => f.id === mapId) ?? flows[0] ?? null;
  const [stepId, setStepId] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ title: string; seed: StepSeed } | null>(null);
  const [lanesMode, setLanesMode] = useState(false);
  const [mapForm, setMapForm] = useState<{ id?: string; title: string; scope: string } | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; go: () => void } | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const codeOf = new Map(codes.map((c) => [c.id, c]));
  const typeOf = new Map(codes.map((c) => [c.id, c.type]));
  const step = flow?.steps.find((s) => s.id === stepId) ?? null;
  const lastRun = runs[0];

  const refresh = () => router.refresh();
  const act = async (body: Record<string, unknown>, done?: string) => {
    if (!flow) return;
    setBusy(true);
    setNotice(null);
    const { error } = await flowAction(flow.id, body);
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: error });
    if (done) setNotice({ tone: "info", text: done });
    refresh();
  };

  async function draw(replace = false) {
    setBusy(true);
    setNotice(null);
    setConfirm(null);
    const res = await projectFlows(projectId, { action: "draw", replace });
    setBusy(false);
    if (res.status === 409 && !replace) return setConfirm({ text: res.error ?? "Redraw?", go: () => draw(true) });
    if (res.error) return setNotice({ tone: "error", text: res.error });
    const r = res.result as { maps: number; accepted: number; rejected: number; costUsd: number | null };
    setNotice({
      tone: "info",
      text: `Drew ${r.maps} map${r.maps === 1 ? "" : "s"} with ${r.accepted} steps${r.rejected ? `; ${r.rejected} need review` : ""} (${money(r.costUsd)}).`,
    });
    router.replace(`/projects/${projectId}?view=swimlanes`, { scroll: false });
    refresh();
  }

  async function saveMap() {
    if (!mapForm) return;
    setBusy(true);
    const res = mapForm.id
      ? await flowAction(mapForm.id, { action: "update", changes: { title: mapForm.title, scope: mapForm.scope } })
      : await projectFlows(projectId, { action: "create", title: mapForm.title, scope: mapForm.scope });
    setBusy(false);
    if (res.error) return setNotice({ tone: "error", text: res.error });
    const newId = !mapForm.id ? (res.result as { id: string }).id : null;
    setMapForm(null);
    if (newId) router.replace(`/projects/${projectId}?view=swimlanes&map=${newId}`, { scroll: false });
    refresh();
  }

  const newStep = (laneId: string, position: number, insert: boolean): StepSeed => ({ laneId, position, insert, label: "", kind: "task", note: "", codeIds: [] });
  const small = { fontSize: 11.5, padding: "2px 8px" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <p className="meta" style={{ margin: 0, maxWidth: "72ch" }}>
          How work gets done today, as participants described it: who does each step, in what order, where it waits and
          where it hurts. Every step rests on the codes it cites.
        </p>
        {editor && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
            <button className="btn btn-secondary" onClick={() => setMapForm({ title: "", scope: "" })} disabled={busy}>
              New map
            </button>
            <button className="btn btn-primary" onClick={() => draw(false)} disabled={busy}>
              {busy ? "Working…" : flows.some((f) => f.origin === "claude") ? "Redraw with Claude" : "Draw with Claude"}
            </button>
          </div>
        )}
      </div>

      {confirm && (
        <div className="panel" style={{ padding: "var(--space-3) var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>{confirm.text}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={confirm.go}>
              Redraw
            </button>
          </span>
        </div>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {lastRun && (
        <span className="meta" style={{ fontSize: 11.5 }}>
          Last drawn by {lastRun.started_by} · {new Date(lastRun.started_at).toLocaleString()} ·{" "}
          {lastRun.status === "failed" ? `failed: ${lastRun.error}` : lastRun.status === "running" ? "still running" : `${lastRun.accepted} steps kept, ${lastRun.rejected} for review · ${money(lastRun.cost_usd)}`}
        </span>
      )}

      {flows.length > 1 && (
        <div className="seg" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
          {flows.map((f) => (
            <Link key={f.id} href={`/projects/${projectId}?view=swimlanes&map=${f.id}`} scroll={false} className="seg-opt" style={{ textDecoration: "none" }}>
              <span style={f.id === flow?.id ? { background: "var(--color-accent-tint)", color: "var(--color-accent-800)", fontWeight: 700 } : undefined}>
                <span className="mono" style={{ fontSize: 10.5, marginRight: 5 }}>
                  {f.ref}
                </span>
                {f.title}
              </span>
            </Link>
          ))}
        </div>
      )}

      {!flow ? (
        <div className="panel" style={{ padding: "var(--space-6)" }}>
          <p className="meta" style={{ margin: 0 }}>
            No process maps yet. {editor ? "Draw them with Claude from the project's Step, Tool, Stakeholder and Pain codes, or start one by hand." : ""}
          </p>
        </div>
      ) : (
        <section className="card" style={{ gap: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
              <span className="card-kicker">
                {flow.ref} · {flow.origin === "claude" ? (flow.touched ? "drafted by Claude, edited" : "drafted by Claude") : "drawn by hand"}
              </span>
              <h3 style={{ fontSize: 20, margin: 0 }}>{flow.title}</h3>
              {flow.scope && <span style={{ fontSize: 13, color: muted(70) }}>{flow.scope}</span>}
            </div>
            {editor && (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <button className="btn btn-ghost" style={small} onClick={() => setMapForm({ id: flow.id, title: flow.title, scope: flow.scope ?? "" })}>
                  Edit title
                </button>
                <button className="btn btn-ghost" style={small} onClick={() => setLanesMode((m) => !m)} aria-pressed={lanesMode}>
                  {lanesMode ? "Done with lanes" : "Edit lanes"}
                </button>
                <button
                  className="btn btn-ghost"
                  style={small}
                  onClick={() => setConfirm({ text: `Delete ${flow.ref} · ${flow.title}? Its steps go with it.`, go: () => { setConfirm(null); act({ action: "delete" }); router.replace(`/projects/${projectId}?view=swimlanes`, { scroll: false }); } })}
                >
                  Delete map
                </button>
              </div>
            )}
          </div>

          <Swimlane
            flow={flow}
            typeOf={typeOf}
            selected={stepId}
            onPick={(id) => setStepId((cur) => (cur === id ? null : id))}
            editor={editor}
            onAddAt={(laneId, position) => setSeed({ title: "Add a step", seed: newStep(laneId, position, false) })}
            laneTools={
              editor && lanesMode
                ? (lane, i) => (
                    <LaneTools
                      name={lane.name}
                      first={i === 0}
                      last={i === flow.lanes.length - 1}
                      onRename={(name) => act({ action: "laneRename", laneId: lane.id, name })}
                      onMove={(delta) => act({ action: "laneMove", laneId: lane.id, delta })}
                      onDelete={() => act({ action: "laneDelete", laneId: lane.id })}
                    />
                  )
                : undefined
            }
          />

          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: muted(65) }}>
            <Legend swatch={{ background: "var(--color-surface)", border: "1px solid var(--line-4)" }} text="Task" />
            <Legend swatch={{ background: "var(--color-navy)" }} text="Wait: the work stops" />
            <Legend swatch={{ background: "var(--color-surface)", border: "2px solid var(--color-accent-600)" }} text="Decision" />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PAIN }} />
              Pain point: rests on a Pain or Constraint code
            </span>
            {editor && lanesMode && <AddLane onAdd={(name) => act({ action: "laneCreate", name })} />}
          </div>
        </section>
      )}

      {rejections.length > 0 && (
        <section className="card" style={{ gap: "var(--space-2)" }}>
          <span className="card-kicker">Needs review · {rejections.length}</span>
          <span className="meta" style={{ fontSize: 12 }}>
            Steps Claude proposed that didn&apos;t pass the checks. Fix one to add it to a map, or dismiss it.
          </span>
          {rejections.map((r) => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-3)", padding: "6px 0", borderTop: `1px solid ${muted(7)}` }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12.5 }}>
                  {r.proposal.label ?? "(no label)"}{" "}
                  <span className="meta" style={{ fontSize: 11.5 }}>
                    {[r.proposal.map, typeof r.proposal.lane === "string" ? r.proposal.lane : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: muted(62) }}>{r.reason}</span>
              </span>
              {editor && (
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {flow && (
                    <button
                      className="btn btn-ghost"
                      style={small}
                      onClick={() => {
                        const lane = flow.lanes.find((l) => l.name.toLowerCase() === String(r.proposal.lane ?? "").toLowerCase()) ?? flow.lanes[0];
                        if (!lane) return setNotice({ tone: "error", text: "Add a lane to this map first." });
                        const keys = new Set((r.proposal.codes ?? []).map((k) => k.toUpperCase()));
                        setSeed({
                          title: "Fix a proposed step",
                          seed: {
                            rejectionId: r.id,
                            laneId: lane.id,
                            position: Math.max(1, Number(r.proposal.position) || 1),
                            insert: true,
                            label: r.proposal.label ?? "",
                            kind: (r.proposal.kind as StepSeed["kind"]) ?? "task",
                            note: r.proposal.note ?? "",
                            codeIds: codes.filter((c) => keys.has(c.key.toUpperCase()) || (r.proposal.code_ids ?? []).includes(c.id)).map((c) => c.id),
                          },
                        });
                      }}
                    >
                      Fix
                    </button>
                  )}
                  <button className="btn btn-ghost" style={small} onClick={() => flow && act({ action: "dismiss", rejectionId: r.id })}>
                    Dismiss
                  </button>
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {flow && step && (
        <aside
          role="dialog"
          aria-label={step.label}
          className="panel"
          style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(460px, 100vw)", zIndex: 60, borderRadius: 0, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", background: "var(--color-surface)" }}
        >
          <header style={{ background: "var(--color-navy)", color: "#FFFFFF", padding: "var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--color-navy-muted)" }}>
                {flow.ref} · {flow.lanes.find((l) => l.id === step.laneId)?.name.toUpperCase()} · STEP {[...new Set(flow.steps.map((s) => s.position))].sort((a, b) => a - b).indexOf(step.position) + 1} ·{" "}
                {step.kind.toUpperCase()}
              </span>
              <h3 style={{ fontSize: 16, margin: "3px 0 0", color: "#FFFFFF", lineHeight: 1.3 }}>{step.label}</h3>
            </div>
            <button className="btn" onClick={() => setStepId(null)} aria-label="Close" style={{ color: "#FFFFFF", borderColor: "rgba(255,255,255,0.35)", padding: "2px 9px" }}>
              ✕
            </button>
          </header>
          <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {step.note && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{step.note}</p>}
            {isPain(step, typeOf) && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-navy)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: PAIN }} />
                A pain point: it rests on a Pain or Constraint code.
              </span>
            )}
            {step.lastEdit && (
              <span className="meta" style={{ fontSize: 11.5 }}>
                Last edit by {step.lastEdit.by}: {step.lastEdit.text}
              </span>
            )}
            {editor && (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  style={small}
                  onClick={() => setSeed({ title: "Edit step", seed: { stepId: step.id, laneId: step.laneId, position: step.position, insert: false, label: step.label, kind: step.kind, note: step.note ?? "", codeIds: step.codeIds } })}
                >
                  Edit
                </button>
                <button className="btn btn-ghost" style={small} onClick={() => setSeed({ title: "Insert a step after this one", seed: newStep(step.laneId, step.position + 1, true) })}>
                  Insert step after
                </button>
                {step.lastEdit && (
                  <button className="btn btn-ghost" style={small} onClick={() => act({ action: "stepRevert", stepId: step.id }, "Reverted the last edit.")}>
                    Revert last edit
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  style={small}
                  onClick={() => setConfirm({ text: `Delete the step "${step.label}"?`, go: () => { setConfirm(null); setStepId(null); act({ action: "stepDelete", stepId: step.id }); } })}
                >
                  Delete
                </button>
              </div>
            )}
            <span className="kicker" style={{ fontSize: 10, marginTop: "var(--space-2)" }}>
              Rests on {step.codeIds.length} code{step.codeIds.length === 1 ? "" : "s"}
            </span>
            {step.codeIds.map((id) => {
              const c = codeOf.get(id);
              if (!c) return null;
              const iv = interviews.find((i) => i.id === c.transcriptId);
              return (
                <div key={id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontSize: 9.5, padding: "1px 5px", background: "var(--color-accent-200)", color: "var(--color-navy)", flex: "none" }}>
                      {c.key}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label}</span>
                    <Link href={`/transcripts/${c.transcriptId}#L${c.line_start}`} className="mono" style={{ fontSize: 10, marginLeft: "auto", color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>
                      L{c.line_start}
                      {c.line_end > c.line_start ? `–${c.line_end}` : ""} →
                    </Link>
                  </div>
                  <span className="meta" style={{ fontSize: 11 }}>
                    {c.type} · {iv?.participant ?? iv?.title}
                  </span>
                  <blockquote style={{ margin: 0, padding: "4px 0 4px 10px", borderLeft: `2px solid ${c.type === "Pain" || c.type === "Constraint" ? PAIN : "var(--color-accent-300)"}`, fontSize: 12.5, lineHeight: 1.5, color: muted(80) }}>
                    “{c.verbatim}”
                  </blockquote>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {seed && flow && (
        <StepEditor title={seed.title} seed={seed.seed} flowId={flow.id} lanes={flow.lanes} interviews={interviews} codes={codes} onClose={() => setSeed(null)} onSaved={refresh} />
      )}
      {mapForm && (
        <Dialog title={mapForm.id ? "Edit process map" : "New process map"} onClose={busy ? undefined : () => setMapForm(null)}>
          <Field label="Title" hint="The process, for example “Quarterly grant reporting”.">
            <input className="input" value={mapForm.title} onChange={(e) => setMapForm({ ...mapForm, title: e.target.value })} autoFocus />
          </Field>
          <Field label="Scope" hint="Where it starts and where it ends, in a sentence.">
            <textarea className="input" rows={2} value={mapForm.scope} onChange={(e) => setMapForm({ ...mapForm, scope: e.target.value })} />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setMapForm(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveMap} disabled={busy || !mapForm.title.trim()}>
              {mapForm.id ? "Save" : "Create map"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Legend({ swatch, text }: { swatch: React.CSSProperties; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 16, height: 11, borderRadius: 2, boxSizing: "border-box", ...swatch }} />
      {text}
    </span>
  );
}

function LaneTools({
  name,
  first,
  last,
  onRename,
  onMove,
  onDelete,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onRename: (name: string) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(name);
  const tiny = { fontSize: 11, padding: "1px 6px" } as const;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() && value.trim() !== name && onRename(value.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label="Lane name"
        style={{ fontSize: 12, padding: "3px 6px" }}
      />
      <span style={{ display: "flex", gap: 4 }}>
        <button className="btn btn-ghost" style={tiny} onClick={() => onMove(-1)} disabled={first} aria-label="Move lane up">
          ↑
        </button>
        <button className="btn btn-ghost" style={tiny} onClick={() => onMove(1)} disabled={last} aria-label="Move lane down">
          ↓
        </button>
        <button className="btn btn-ghost" style={tiny} onClick={onDelete} aria-label="Delete lane" title="Only an empty lane can be deleted">
          ✕
        </button>
      </span>
    </span>
  );
}

function AddLane({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
      <input className="input" placeholder="New lane (role, team or system)" value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 12, padding: "3px 8px", width: 240 }} />
      <button
        className="btn btn-secondary"
        style={{ fontSize: 11.5, padding: "2px 10px" }}
        disabled={!name.trim()}
        onClick={() => {
          onAdd(name.trim());
          setName("");
        }}
      >
        Add lane
      </button>
    </span>
  );
}
