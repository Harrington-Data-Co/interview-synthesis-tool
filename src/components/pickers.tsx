"use client";

import { useId, useState } from "react";
import { Field } from "@/components/ui";
import type { Directory, OrgOption, PersonOption } from "@/lib/directory";
import { orgChain, withPaths } from "@/lib/directory";
import type { SpeakerRole } from "@/lib/ingest/preview";

/** Client, then only that client's projects. The transcript stores the
 *  project; the client is implied by it. */
export function ClientProjectPicker({
  directory,
  projectId,
  onChange,
  noneLabel = "Unassigned",
}: {
  directory: Pick<Directory, "clients" | "projects">;
  projectId: string;
  onChange: (projectId: string) => void;
  noneLabel?: string;
}) {
  const implied = directory.projects.find((p) => p.id === projectId)?.clientId ?? "";
  const [clientId, setClientId] = useState(implied);
  const projects = directory.projects.filter((p) => p.clientId === clientId);

  return (
    <>
      <Field label="Client" hint="Who the project is for.">
        <select
          className="input"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            onChange("");
          }}
        >
          <option value="">{noneLabel}</option>
          {directory.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Project">
        <select className="input" value={projectId} disabled={!clientId} onChange={(e) => onChange(e.target.value)}>
          <option value="">{clientId ? "Choose a project…" : "—"}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

const NEW = "__new__";

/** Pick an organization by its path, or create one (optionally nested) in
 *  place. New organizations are reported upward so every picker sees them. */
export function OrgPicker({
  organizations,
  value,
  onChange,
  onCreated,
  compact = false,
  disabled = false,
}: {
  organizations: OrgOption[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (org: OrgOption) => void;
  /** Reads as plain text until hovered or focused, for editing in a table cell. */
  compact?: boolean;
  disabled?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parentId: parentId || null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't create it.");
    // Recompute the new row's path against the list it joins.
    const all = withPaths([...organizations.map((o) => ({ id: o.id, name: o.name, parent_id: o.parentId })), body]);
    onCreated(all.find((o) => o.id === body.id)!);
    onChange(body.id);
    setCreating(false);
    setName("");
    setParentId("");
  }

  if (creating) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
        <input
          className="input"
          placeholder="Organization name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && create()}
          style={{ fontSize: 12.5 }}
        />
        <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ fontSize: 12.5 }}>
          <option value="">Top level</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              Under {o.path}
            </option>
          ))}
        </select>
        {error && <span style={{ fontSize: 11, color: "var(--color-accent-800)" }}>{error}</span>}
        <span style={{ display: "flex", gap: 4 }}>
          <button className="btn btn-primary" style={{ fontSize: 11.5 }} disabled={busy || !name.trim()} onClick={create}>
            {busy ? "Adding…" : "Add"}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 11.5 }} disabled={busy} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </span>
      </div>
    );
  }

  return (
    <select
      className={compact ? "input cell-input" : "input"}
      value={value}
      disabled={disabled}
      onChange={(e) => (e.target.value === NEW ? setCreating(true) : onChange(e.target.value))}
      style={{ fontSize: 12.5, minWidth: compact ? 0 : 180 }}
      aria-label="Organization"
      title={organizations.find((o) => o.id === value)?.path}
    >
      <option value="">No organization</option>
      {organizations.map((o) => (
        <option key={o.id} value={o.id}>
          {o.path}
        </option>
      ))}
      <option value={NEW}>New organization…</option>
    </select>
  );
}

/** One speaker in the table. personText is what was typed in the Person
 *  field; personId (a known person) or newPerson (a name to create) is what
 *  it resolves to, and neither means not identified. */
export type SpeakerValue = {
  personText: string;
  personId: string;
  newPerson: string;
  role: SpeakerRole;
  organizationId: string;
  title: string;
};
export type SpeakerRow = { name: string; detail?: React.ReactNode };

/** How a person reads in the Person field: their name, and their current
 *  organization when two people share a name. */
export function personLabel(p: PersonOption, people: PersonOption[], orgs: OrgOption[]): string {
  const namesake = people.some((o) => o.id !== p.id && o.name.toLowerCase() === p.name.toLowerCase());
  const org = namesake && p.organizationId ? orgs.find((o) => o.id === p.organizationId)?.name : null;
  return org ? `${p.name} · ${org}` : p.name;
}

/** A starting value for a speaker: the person it names (known or new), its
 *  part, organization and title. */
export function speakerValue(
  v: { personId: string | null; newPerson: string | null; role: SpeakerRole; organizationId: string | null; title: string | null },
  people: PersonOption[],
  orgs: OrgOption[],
): SpeakerValue {
  const known = v.personId ? people.find((p) => p.id === v.personId) : undefined;
  return {
    personText: known ? personLabel(known, people, orgs) : (v.newPerson ?? ""),
    personId: known?.id ?? "",
    newPerson: known ? "" : (v.newPerson ?? ""),
    role: v.role,
    organizationId: v.organizationId ?? "",
    title: v.title ?? "",
  };
}

/** Who's speaking: the name as the export wrote it (fixed), who that is,
 *  their part in the call, and their organization and title at the time.
 *  Picking a known person fills in their current organization and title
 *  where those are empty. Two names for one person (phone, then laptop):
 *  pick the same person on both rows. Shared by the upload review and
 *  source-record editing. */
export function SpeakersEditor({
  rows,
  values,
  onChange,
  organizations,
  onOrgCreated,
  people,
}: {
  rows: SpeakerRow[];
  values: Record<string, SpeakerValue>;
  onChange: (name: string, v: SpeakerValue) => void;
  organizations: OrgOption[];
  onOrgCreated: (org: OrgOption) => void;
  people: PersonOption[];
}) {
  const listId = useId();
  const labels = people.map((p) => ({ p, label: personLabel(p, people, organizations) }));
  // Who each row resolves to, to spot one person under two names.
  const ofRow = (v: SpeakerValue) => v.personId || (v.newPerson ? `new:${v.newPerson.toLowerCase()}` : "");
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = values[r.name] && ofRow(values[r.name]);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const typed = (v: SpeakerValue, text: string): SpeakerValue => {
    const t = text.trim().toLowerCase();
    const exact = labels.find((x) => x.label.toLowerCase() === t);
    const byName = labels.filter((x) => x.p.name.toLowerCase() === t);
    const hit = exact?.p ?? (byName.length === 1 ? byName[0].p : undefined);
    if (!hit) return { ...v, personText: text, personId: "", newPerson: text.trim() };
    return {
      ...v,
      personText: text,
      personId: hit.id,
      newPerson: "",
      organizationId: v.organizationId || hit.organizationId || "",
      title: v.title || hit.title || "",
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <datalist id={listId}>
        {labels.map(({ p, label }) => (
          <option key={p.id} value={label} />
        ))}
      </datalist>
      <div className="panel" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>As written</th>
              <th>Person</th>
              <th>Part</th>
              <th>Organization</th>
              <th>Title</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = values[r.name];
              const set = (patch: Partial<SpeakerValue>) => onChange(r.name, { ...v, ...patch });
              const shared = (counts.get(ofRow(v)) ?? 0) > 1;
              return (
                <tr key={r.name}>
                  <td style={{ verticalAlign: "top", maxWidth: 200 }}>
                    <span className="mono" style={{ fontSize: 12.5 }}>
                      {r.name}
                    </span>
                    {r.detail && (
                      <div className="meta" style={{ fontSize: 11.5, marginTop: 2 }}>
                        {r.detail}
                      </div>
                    )}
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <input
                      className="input"
                      list={listId}
                      value={v.personText}
                      placeholder="Not identified"
                      onChange={(e) => onChange(r.name, typed(v, e.target.value))}
                      style={{ fontSize: 12.5, minWidth: 170 }}
                      aria-label={`Who ${r.name} is`}
                    />
                    <div className="meta" style={{ fontSize: 11, marginTop: 3 }}>
                      {v.personId ? "Known person" : v.newPerson ? "New person" : "Not identified"}
                      {shared && " · same person as another row"}
                    </div>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <select
                      className="input"
                      value={v.role}
                      onChange={(e) => set({ role: e.target.value as SpeakerRole })}
                      style={{ fontSize: 12.5 }}
                      aria-label={`Part in the call for ${r.name}`}
                    >
                      <option value="interviewer">Interviewer</option>
                      <option value="participant">Participant</option>
                      <option value="other">Other</option>
                    </select>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <OrgPicker organizations={organizations} value={v.organizationId} onChange={(id) => set({ organizationId: id })} onCreated={onOrgCreated} />
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <input
                      className="input"
                      value={v.title}
                      placeholder="e.g. Program officer"
                      onChange={(e) => set({ title: e.target.value })}
                      style={{ fontSize: 12.5, minWidth: 140 }}
                      aria-label={`Title for ${r.name}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="meta" style={{ fontSize: 11.5 }}>
        Someone joined twice (phone, then laptop)? Pick the same person on both rows. Organization and title are as of this call; picking a known person fills in their latest.
      </span>
    </div>
  );
}

const NONE_OPT = "";

/** An organization picked level by level, as rows of a definition list:
 *  Organization (top level), then Sub-organization under whatever is
 *  chosen, one row per level, with "None" meaning the whole organization
 *  above and "New sub-organization…" to add one in place. `onShow`, when
 *  given, puts a link on each chosen level (to filter a table by it). */
export function OrgLevels({
  organizations,
  value,
  onChange,
  onCreated,
  disabled = false,
  editable = true,
  onShow,
}: {
  organizations: OrgOption[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (org: OrgOption) => void;
  disabled?: boolean;
  editable?: boolean;
  onShow?: (org: OrgOption) => void;
}) {
  const [adding, setAdding] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chain = orgChain(value, organizations);
  const byName = (a: OrgOption, b: OrgOption) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const childrenOf = (id: string | null) => organizations.filter((o) => o.parentId === id).sort(byName);
  // One row per chosen level, plus the next level down once something is
  // chosen (editors can add a sub-organization there).
  const levels = editable && chain.length ? chain.length + 1 : Math.max(chain.length, 1);

  async function create(level: number) {
    setBusy(true);
    setError("");
    const parentId = level === 0 ? null : chain[level - 1].id;
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't create it.");
    const all = withPaths([...organizations.map((o) => ({ id: o.id, name: o.name, parent_id: o.parentId })), body]);
    onCreated(all.find((o) => o.id === body.id)!);
    onChange(body.id);
    setAdding(null);
    setName("");
  }

  return (
    <>
      {Array.from({ length: levels }, (_, level) => {
        const parent = level === 0 ? null : chain[level - 1];
        const chosen = chain[level];
        const options = childrenOf(parent?.id ?? null);
        const label = level === 0 ? "Organization" : "Sub-organization";
        let field: React.ReactNode;
        if (!editable) {
          field = chosen?.name ?? "—";
        } else if (adding === level) {
          field = (
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ display: "flex", gap: 4 }}>
                <input
                  className="input"
                  autoFocus
                  placeholder={parent ? `New under ${parent.name}` : "New organization"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) create(level);
                    if (e.key === "Escape") setAdding(null);
                  }}
                  style={{ fontSize: 12.5 }}
                />
                <button className="btn btn-primary" style={{ fontSize: 11.5 }} disabled={busy || !name.trim()} onClick={() => create(level)}>
                  {busy ? "Adding…" : "Add"}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 11.5 }} disabled={busy} onClick={() => setAdding(null)}>
                  Cancel
                </button>
              </span>
              {error && <span style={{ fontSize: 11, color: "var(--color-accent-800)" }}>{error}</span>}
            </span>
          );
        } else {
          field = (
            <select
              className="input"
              value={chosen?.id ?? NONE_OPT}
              disabled={disabled}
              aria-label={label}
              onChange={(e) => {
                const v = e.target.value;
                if (v === NEW) {
                  setName("");
                  setError("");
                  return setAdding(level);
                }
                // None at this level means the organization above it.
                onChange(v || parent?.id || "");
              }}
              style={{ fontSize: 12.5 }}
            >
              <option value={NONE_OPT}>{parent ? `None — all of ${parent.name}` : "No organization"}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
              <option value={NEW}>{parent ? "New sub-organization…" : "New organization…"}</option>
            </select>
          );
        }
        return (
          <div key={level} style={{ display: "contents" }}>
            <dt
              style={{
                color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                fontSize: 12,
                alignSelf: "start",
                paddingTop: 2,
                paddingLeft: level > 1 ? (level - 1) * 10 : 0,
              }}
            >
              {label}
            </dt>
            <dd style={{ margin: 0, minWidth: 0, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, minWidth: 0 }}>{field}</span>
              {onShow && chosen && adding !== level && (
                <button
                  type="button"
                  className="meta"
                  onClick={() => onShow(chosen)}
                  title={level === 0 ? `Everyone at ${chosen.name}, sub-organizations included` : `Everyone in ${chosen.name}`}
                  style={{ border: 0, background: "none", cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap", flex: "none" }}
                >
                  Show all ↗
                </button>
              )}
            </dd>
          </div>
        );
      })}
    </>
  );
}
