"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, Field, Notice } from "@/components/ui";
import type { LoadedArch } from "@/lib/arch/load";
import type { NodeKind } from "@/lib/arch/prompt";
import { archAction, projectArch } from "./actions";
import { ArchDiagram, PAIN, type Selection } from "./ArchDiagram";
import { ArchItemEditor, type ItemSeed } from "./ArchItemEditor";

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
const money = (n: number | null) => (n === null ? "cost unknown" : `$${Number(n).toFixed(2)}`);

/** Deliverable: the current-state architecture. The systems as participants
 *  described them, how data moves between them (mostly by hand, usually),
 *  and the numbered gaps; every item opens onto the quotes it rests on. */
export function ArchView({ projectId, editor, data, mapId }: { projectId: string; editor: boolean; data: LoadedArch; mapId: string | undefined }) {
  const router = useRouter();
  const { maps, codes, interviews, rejections, runs } = data;
  const map = maps.find((m) => m.id === mapId) ?? maps[0] ?? null;
  const [selected, setSelected] = useState<Selection>(null);
  const [seed, setSeed] = useState<ItemSeed | null>(null);
  const [mapForm, setMapForm] = useState<{ id?: string; title: string; scope: string } | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; go: () => void } | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const codeOf = new Map(codes.map((c) => [c.id, c]));
  const typeOf = new Map(codes.map((c) => [c.id, c.type]));
  const nodeOf = new Map((map?.nodes ?? []).map((n) => [n.id, n]));
  const lastRun = runs[0];
  const small = { fontSize: 11.5, padding: "2px 8px" } as const;
  const href = (id?: string) => `/projects/${projectId}?view=architecture${id ? `&map=${id}` : ""}`;

  const item =
    !map || !selected
      ? null
      : selected.kind === "node"
        ? map.nodes.find((n) => n.id === selected.id)
        : selected.kind === "flow"
          ? map.flows.find((f) => f.id === selected.id)
          : map.gaps.find((g) => g.id === selected.id);

  async function act(body: Record<string, unknown>, done?: string) {
    if (!map) return;
    setBusy(true);
    setNotice(null);
    const { error } = await archAction(map.id, body);
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: error });
    if (done) setNotice({ tone: "info", text: done });
    router.refresh();
  }

  async function draw(replace = false) {
    setBusy(true);
    setNotice(null);
    setConfirm(null);
    const res = await projectArch(projectId, { action: "draw", replace });
    setBusy(false);
    if (res.status === 409 && !replace) return setConfirm({ text: res.error ?? "Redraw?", go: () => draw(true) });
    if (res.error) return setNotice({ tone: "error", text: res.error });
    const r = res.result as { maps: number; accepted: number; rejected: number; costUsd: number | null };
    setNotice({ tone: "info", text: `Drew ${r.maps} map${r.maps === 1 ? "" : "s"}: ${r.accepted} systems, flows and gaps${r.rejected ? `; ${r.rejected} need review` : ""} (${money(r.costUsd)}).` });
    router.replace(href(), { scroll: false });
    router.refresh();
  }

  async function saveMap() {
    if (!mapForm) return;
    setBusy(true);
    const res = mapForm.id
      ? await archAction(mapForm.id, { action: "update", changes: { title: mapForm.title, scope: mapForm.scope } })
      : await projectArch(projectId, { action: "create", title: mapForm.title, scope: mapForm.scope });
    setBusy(false);
    if (res.error) return setNotice({ tone: "error", text: res.error });
    const newId = !mapForm.id ? (res.result as { id: string }).id : null;
    setMapForm(null);
    if (newId) router.replace(href(newId), { scroll: false });
    router.refresh();
  }

  const edit = () => {
    if (!map || !selected || !item) return;
    if (selected.kind === "node") {
      const n = item as (typeof map.nodes)[number];
      setSeed({ kind: "node", itemId: n.id, name: n.name, nodeKind: n.kind, official: n.official, note: n.note ?? "", codeIds: n.codeIds });
    } else if (selected.kind === "flow") {
      const f = item as (typeof map.flows)[number];
      setSeed({ kind: "flow", itemId: f.id, fromNode: f.from, toNode: f.to, label: f.label, manual: f.manual, note: f.note ?? "", codeIds: f.codeIds });
    } else {
      const g = item as (typeof map.gaps)[number];
      setSeed({ kind: "gap", itemId: g.id, title: g.title, note: g.note ?? "", codeIds: g.codeIds });
    }
  };
  const itemName = (s: Selection) => {
    if (!s || !map) return "";
    if (s.kind === "node") return nodeOf.get(s.id)?.name ?? "";
    if (s.kind === "flow") {
      const f = map.flows.find((x) => x.id === s.id);
      return f ? `${nodeOf.get(f.from)?.name} → ${nodeOf.get(f.to)?.name}` : "";
    }
    return map.gaps.find((g) => g.id === s.id)?.title ?? "";
  };
  const flowsOf = (id: string) => (map?.flows ?? []).filter((f) => f.from === id || f.to === id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <p className="meta" style={{ margin: 0, maxWidth: "72ch" }}>
          The systems as participants described using them, not as documented: where data lives, how it moves (usually by
          hand), the workarounds people built, and the gaps. Every item rests on the codes it cites.
        </p>
        {editor && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
            <button className="btn btn-secondary" onClick={() => setMapForm({ title: "", scope: "" })} disabled={busy}>
              New map
            </button>
            <button className="btn btn-primary" onClick={() => draw(false)} disabled={busy}>
              {busy ? "Working…" : maps.some((m) => m.origin === "claude") ? "Redraw" : "Draw"}
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
              Go ahead
            </button>
          </span>
        </div>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {lastRun && (
        <span className="meta" style={{ fontSize: 11.5 }}>
          Last drawn by {lastRun.started_by} · {new Date(lastRun.started_at).toLocaleString()} ·{" "}
          {lastRun.status === "failed" ? `failed: ${lastRun.error}` : lastRun.status === "running" ? "still running" : `${lastRun.accepted} items kept, ${lastRun.rejected} for review · ${money(lastRun.cost_usd)}`}
        </span>
      )}
      {maps.length > 1 && (
        <div className="seg" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
          {maps.map((m) => (
            <Link key={m.id} href={href(m.id)} scroll={false} className="seg-opt" style={{ textDecoration: "none" }}>
              <span style={m.id === map?.id ? { background: "var(--color-accent-tint)", color: "var(--color-accent-800)", fontWeight: 700 } : undefined}>
                <span className="mono" style={{ fontSize: 10.5, marginRight: 5 }}>
                  {m.ref}
                </span>
                {m.title}
              </span>
            </Link>
          ))}
        </div>
      )}

      {!map ? (
        <div className="panel" style={{ padding: "var(--space-6)" }}>
          <p className="meta" style={{ margin: 0 }}>
            No architecture map yet. {editor ? "Draw one with Claude from the project's Tool, Step, Stakeholder and Pain codes, or start one by hand." : ""}
          </p>
        </div>
      ) : (
        <section className="card" style={{ gap: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
              <span className="card-kicker">
                {map.ref} · {map.origin === "claude" ? (map.touched ? "drafted by Claude, edited" : "drafted by Claude") : "drawn by hand"} · {map.nodes.length} systems,{" "}
                {map.flows.length} flows ({map.flows.filter((f) => f.manual).length} by hand)
              </span>
              <h3 style={{ fontSize: 20, margin: 0 }}>{map.title}</h3>
              {map.scope && <span style={{ fontSize: 13, color: muted(70) }}>{map.scope}</span>}
            </div>
            {editor && (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <button className="btn btn-ghost" style={small} onClick={() => setSeed({ kind: "node", name: "", nodeKind: "system", official: true, note: "", codeIds: [] })}>
                  + System
                </button>
                <button
                  className="btn btn-ghost"
                  style={small}
                  disabled={map.nodes.length < 2}
                  onClick={() => setSeed({ kind: "flow", fromNode: map.nodes[0]?.id ?? "", toNode: map.nodes[1]?.id ?? "", label: "", manual: true, note: "", codeIds: [] })}
                >
                  + Flow
                </button>
                <button className="btn btn-ghost" style={small} onClick={() => setSeed({ kind: "gap", title: "", note: "", codeIds: [] })}>
                  + Gap
                </button>
                <button className="btn btn-ghost" style={small} onClick={() => setMapForm({ id: map.id, title: map.title, scope: map.scope ?? "" })}>
                  Edit title
                </button>
                <button
                  className="btn btn-ghost"
                  style={small}
                  onClick={() =>
                    setConfirm({
                      text: `Delete ${map.ref} · ${map.title}? Its systems, flows and gaps go with it.`,
                      go: () => {
                        setConfirm(null);
                        act({ action: "delete" });
                        router.replace(href(), { scroll: false });
                      },
                    })
                  }
                >
                  Delete map
                </button>
              </div>
            )}
          </div>

          <ArchDiagram key={map.id} map={map} typeOf={typeOf} selected={selected} onSelect={setSelected} />

          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: muted(65) }}>
            <Legend box={{ background: "var(--color-surface)", border: "1px solid var(--line-4)" }} text="Official system" />
            <Legend box={{ background: "var(--color-accent-100)", border: "1.5px dashed var(--color-accent-600)" }} text="Workaround people built" />
            <Legend line="var(--color-navy)" text="A person moves it" />
            <Legend line="var(--color-accent)" thick text="The systems move it" />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PAIN }} />
              Rests on a Pain or Constraint code
            </span>
            <span>Pick a system to see its flows; a gap to see what it touches.</span>
          </div>

          {map.gaps.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
              {map.gaps.map((g, i) => {
                const picked = selected?.kind === "gap" && selected.id === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelected(picked ? null : { kind: "gap", id: g.id })}
                    aria-pressed={picked}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "grid",
                      gridTemplateColumns: "28px 1fr",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: picked ? "var(--color-accent-tint)" : undefined,
                      boxShadow: picked ? "inset 3px 0 0 var(--color-accent-700)" : undefined,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 20, color: "var(--color-accent)", lineHeight: 1 }}>{i + 1}</span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--color-navy)" }}>{g.title}</span>
                      {g.note && <span style={{ fontSize: 12, color: muted(65), lineHeight: 1.45 }}>{g.note}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {rejections.length > 0 && (
        <section className="card" style={{ gap: "var(--space-2)" }}>
          <span className="card-kicker">Needs review · {rejections.length}</span>
          <span className="meta" style={{ fontSize: 12 }}>
            Items Claude proposed that didn&apos;t pass the checks. Add one by hand if it belongs, or dismiss it.
          </span>
          {rejections.map((r) => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-3)", padding: "6px 0", borderTop: `1px solid ${muted(7)}` }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12.5 }}>
                  <span className="meta" style={{ fontSize: 11, textTransform: "capitalize", marginRight: 6 }}>
                    {String(r.proposal.item ?? "item")}
                  </span>
                  {String(r.proposal.name ?? r.proposal.title ?? r.proposal.carries ?? r.proposal.label ?? "")}
                </span>
                <span style={{ fontSize: 11.5, color: muted(62) }}>{r.reason}</span>
              </span>
              {editor && map && (
                <button className="btn btn-ghost" style={small} onClick={() => act({ action: "dismiss", rejectionId: r.id })}>
                  Dismiss
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {map && selected && item && (
        <aside
          role="dialog"
          aria-label={itemName(selected)}
          className="panel"
          style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(460px, 100vw)", zIndex: 60, borderRadius: 0, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", background: "var(--color-surface)" }}
        >
          <header style={{ background: "var(--color-navy)", color: "#FFFFFF", padding: "var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--color-navy-muted)" }}>
                {map.ref} ·{" "}
                {selected.kind === "node"
                  ? `${(item as { kind: NodeKind }).kind.toUpperCase()}${(item as { official: boolean }).official ? "" : " · WORKAROUND"}`
                  : selected.kind === "flow"
                    ? (item as { manual: boolean }).manual
                      ? "FLOW · BY HAND"
                      : "FLOW · AUTOMATIC"
                    : `GAP ${map.gaps.findIndex((g) => g.id === selected.id) + 1}`}
              </span>
              <h3 style={{ fontSize: 16, margin: "3px 0 0", color: "#FFFFFF", lineHeight: 1.3 }}>
                {selected.kind === "flow" ? (item as { label: string }).label : itemName(selected)}
              </h3>
              {selected.kind === "flow" && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>{itemName(selected)}</span>}
            </div>
            <button className="btn" onClick={() => setSelected(null)} aria-label="Close" style={{ color: "#FFFFFF", borderColor: "rgba(255,255,255,0.35)", padding: "2px 9px" }}>
              ✕
            </button>
          </header>
          <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {(item as { note: string | null }).note && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{(item as { note: string | null }).note}</p>}
            {editor && (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <button className="btn btn-secondary" style={small} onClick={edit}>
                  Edit
                </button>
                <button
                  className="btn btn-ghost"
                  style={small}
                  onClick={() =>
                    setConfirm({
                      text: `Delete "${itemName(selected)}"?${selected.kind === "node" ? " Its flows go with it." : ""}`,
                      go: () => {
                        setConfirm(null);
                        const s = selected;
                        setSelected(null);
                        act({ action: "remove", kind: s.kind, itemId: s.id });
                      },
                    })
                  }
                >
                  Delete
                </button>
              </div>
            )}
            {selected.kind === "node" && flowsOf(selected.id).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="kicker" style={{ fontSize: 10 }}>
                  Flows
                </span>
                {flowsOf(selected.id).map((f) => (
                  <button key={f.id} onClick={() => setSelected({ kind: "flow", id: f.id })} style={{ all: "unset", cursor: "pointer", fontSize: 12.5 }}>
                    {f.from === selected.id ? "→ " : "← "}
                    <strong>{nodeOf.get(f.from === selected.id ? f.to : f.from)?.name}</strong>: {f.label}
                    <span className="meta" style={{ fontSize: 11 }}>
                      {" "}
                      · {f.manual ? "by hand" : "automatic"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <span className="kicker" style={{ fontSize: 10, marginTop: "var(--space-2)" }}>
              Rests on {(item as { codeIds: string[] }).codeIds.length} code{(item as { codeIds: string[] }).codeIds.length === 1 ? "" : "s"}
            </span>
            {(item as { codeIds: string[] }).codeIds.map((id) => {
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
                      L{c.line_start} →
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

      {seed && map && <ArchItemEditor seed={seed} map={map} interviews={interviews} codes={codes} onClose={() => setSeed(null)} onSaved={() => router.refresh()} />}
      {mapForm && (
        <Dialog title={mapForm.id ? "Edit architecture map" : "New architecture map"} onClose={busy ? undefined : () => setMapForm(null)}>
          <Field label="Title">
            <input className="input" value={mapForm.title} onChange={(e) => setMapForm({ ...mapForm, title: e.target.value })} autoFocus />
          </Field>
          <Field label="Scope" hint="What this map covers, in a sentence.">
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

function Legend({ box, line, thick, text }: { box?: React.CSSProperties; line?: string; thick?: boolean; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {box && <span style={{ width: 16, height: 11, borderRadius: 2, boxSizing: "border-box", ...box }} />}
      {line && <span style={{ width: 20, height: thick ? 3 : 1.5, background: line, opacity: thick ? 0.85 : 0.5 }} />}
      {text}
    </span>
  );
}
