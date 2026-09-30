"use client";

import { useId, useState } from "react";
import { KIND_SUGGESTIONS, NewOrgForm, OrgCombobox } from "@/components/pickers";
import { Dialog, Field, Notice } from "@/components/ui";
import type { OrgOption } from "@/lib/directory";
import { outlineSize, parseOutline, type OutlineNode } from "@/lib/people/outline";

/** A single new organization, anywhere in the tree. */
export function NewOrgDialog({ organizations, onClose, onCreated }: { organizations: OrgOption[]; onClose: () => void; onCreated: (org: OrgOption) => void }) {
  return (
    <Dialog title="New organization" onClose={onClose}>
      <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
        Name it, say where it sits (or leave it at the top level), and optionally give its short name and what kind of layer it is.
      </p>
      <NewOrgForm organizations={organizations} onCancel={onClose} onCreated={onCreated} />
    </Dialog>
  );
}

const EXAMPLE = `State of Delaware [Government]
  Department of Education (DOE) [Department]
    Office of Early Learning (OEL) [Office]
      Early Childhood Assessment [Unit]
    Office of Child Care Licensing (OCCL) [Office]
  Department of Health and Social Services (DHSS) [Department]
    Division of Public Health (DPH) [Division]`;

/** Many organizations at once, from an indented outline: one per line,
 *  nesting by indentation, an optional (SHORT NAME) and [Kind] at the end of
 *  a line, and a kind for each level for lines that don't give one. The
 *  preview marks what's new and what already exists (and will be reused). */
export function OutlineDialog({
  organizations,
  initialParentId = "",
  onClose,
  onDone,
}: {
  organizations: OrgOption[];
  initialParentId?: string;
  onClose: () => void;
  onDone: (result: { created: number; reused: number }) => void;
}) {
  const [text, setText] = useState("");
  const [parentId, setParentId] = useState(initialParentId);
  const [levelKinds, setLevelKinds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kindsId = useId();
  const kinds = [...new Set([...organizations.map((o) => o.kind).filter((k): k is string => !!k), ...KIND_SUGGESTIONS])];

  const nodes = parseOutline(text, levelKinds);
  const { count, depth } = outlineSize(nodes);
  const parent = organizations.find((o) => o.id === parentId);
  // What already exists: an organization of the same name (ignoring case)
  // under the same parent is reused, not duplicated.
  const existing = (under: string | null, name: string) => organizations.find((o) => o.parentId === under && o.name.toLowerCase() === name.toLowerCase());
  let fresh = 0;
  const preview = (ns: OutlineNode[], under: string | null, d: number): React.ReactNode[] =>
    ns.flatMap((n, i) => {
      const found = under === "__new__" ? undefined : existing(under, n.name);
      if (!found) fresh++;
      return [
        <div key={`${d}-${i}-${n.name}`} style={{ paddingLeft: d * 18, display: "flex", gap: 6, alignItems: "baseline", fontSize: 12.5 }}>
          <span style={{ color: "color-mix(in srgb, var(--color-text) 30%, transparent)" }}>{d ? "└" : "•"}</span>
          <span style={{ fontWeight: d ? 500 : 700 }}>{n.name}</span>
          {n.short_name && <span className="meta">({n.short_name})</span>}
          {n.kind && (
            <span className="meta" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {n.kind}
            </span>
          )}
          <span className={`tag ${found ? "tag-neutral" : "tag-accent"}`} style={{ fontSize: 9.5, marginLeft: "auto" }}>
            {found ? "exists" : "new"}
          </span>
        </div>,
        ...preview(n.children, found ? found.id : "__new__", d + 1),
      ];
    });
  const rows = preview(nodes, parentId || null, 0);

  async function create() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "tree", parentId: parentId || null, nodes }),
    });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(b.error ?? `Couldn't add them (${res.status}).`);
    onDone(b.result);
  }

  return (
    <Dialog title="Add organizations from an outline" onClose={busy ? undefined : onClose} width={880}>
      <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
        One organization per line; indent to nest. End a line with <code>(OEL)</code> for a short name and <code>[Division]</code> for its kind. Anything that already exists under
        the same parent is reused, and gains a short name or kind it lacked.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <Field label="Add under">
            <OrgCombobox organizations={organizations} value={parentId} onChange={setParentId} noneLabel="The top level" label="Add under" />
          </Field>
          <Field label="Outline">
            <textarea
              className="input"
              rows={14}
              value={text}
              placeholder={EXAMPLE}
              onChange={(e) => setText(e.target.value)}
              style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, whiteSpace: "pre", resize: "vertical" }}
              spellCheck={false}
            />
          </Field>
          {depth > 0 && (
            <Field label="Kind at each level" hint="For lines that don't give their own [Kind].">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {Array.from({ length: depth }, (_, d) => (
                  <label key={d} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <span className="meta">Level {d + 1}</span>
                    <input
                      className="input"
                      list={kindsId}
                      value={levelKinds[d] ?? ""}
                      placeholder={d === 0 ? "e.g. Department" : d === 1 ? "e.g. Division" : "e.g. Unit"}
                      onChange={(e) => setLevelKinds((k) => Object.assign([...k], { [d]: e.target.value }))}
                      style={{ fontSize: 12.5 }}
                    />
                  </label>
                ))}
                <datalist id={kindsId}>
                  {kinds.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </div>
            </Field>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span className="kicker" style={{ fontSize: 10 }}>
            Preview {count ? `· ${count} organization${count === 1 ? "" : "s"}, ${depth} level${depth === 1 ? "" : "s"} deep` : ""}
          </span>
          <div className="panel" style={{ padding: "8px 10px", minHeight: 200, maxHeight: 420, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {parent && <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>Under {parent.path}</div>}
            {rows.length ? rows : <span className="meta">Paste or type an outline to see it here.</span>}
          </div>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", alignItems: "center" }}>
        {count > 0 && (
          <span className="meta" style={{ fontSize: 12, marginRight: "auto" }}>
            {fresh} new, {count - fresh} already there
          </span>
        )}
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={create} disabled={busy || !count || !fresh}>
          {busy ? "Adding…" : fresh ? `Add ${fresh} organization${fresh === 1 ? "" : "s"}` : "Nothing new to add"}
        </button>
      </div>
    </Dialog>
  );
}
