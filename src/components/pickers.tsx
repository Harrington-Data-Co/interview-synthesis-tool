"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import type { Directory, OrgOption } from "@/lib/directory";
import { withPaths } from "@/lib/directory";
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
        <select
          className="input"
          value={projectId}
          disabled={!clientId}
          onChange={(e) => onChange(e.target.value)}
        >
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
}: {
  organizations: OrgOption[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (org: OrgOption) => void;
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
    const all = withPaths([
      ...organizations.map((o) => ({ id: o.id, name: o.name, parent_id: o.parentId })),
      body,
    ]);
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
      className="input"
      value={value}
      onChange={(e) => (e.target.value === NEW ? setCreating(true) : onChange(e.target.value))}
      style={{ fontSize: 12.5, minWidth: 180 }}
      aria-label="Organization"
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

export type SpeakerValue = { displayName: string; role: SpeakerRole; organizationId: string };
export type SpeakerRow = { name: string; detail?: React.ReactNode };

/** Who's speaking: name as written (fixed), display name, organization, role.
 *  Shared by the upload review and source-record editing. */
export function SpeakersEditor({
  rows,
  values,
  onChange,
  organizations,
  onOrgCreated,
}: {
  rows: SpeakerRow[];
  values: Record<string, SpeakerValue>;
  onChange: (name: string, v: SpeakerValue) => void;
  organizations: OrgOption[];
  onOrgCreated: (org: OrgOption) => void;
}) {
  return (
    <div className="panel" style={{ overflow: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>As written</th>
            <th>Display name</th>
            <th>Organization</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = values[r.name];
            const set = (patch: Partial<SpeakerValue>) => onChange(r.name, { ...v, ...patch });
            return (
              <tr key={r.name}>
                <td style={{ verticalAlign: "top", maxWidth: 220 }}>
                  <span className="mono" style={{ fontSize: 12.5 }}>
                    {r.name}
                  </span>
                  {r.detail && <div className="meta" style={{ fontSize: 11.5, marginTop: 2 }}>{r.detail}</div>}
                </td>
                <td style={{ verticalAlign: "top" }}>
                  <input
                    className="input"
                    value={v.displayName}
                    placeholder={r.name}
                    onChange={(e) => set({ displayName: e.target.value })}
                    style={{ fontSize: 12.5, minWidth: 150 }}
                    aria-label={`Display name for ${r.name}`}
                  />
                </td>
                <td style={{ verticalAlign: "top" }}>
                  <OrgPicker
                    organizations={organizations}
                    value={v.organizationId}
                    onChange={(id) => set({ organizationId: id })}
                    onCreated={onOrgCreated}
                  />
                </td>
                <td style={{ verticalAlign: "top" }}>
                  <select
                    className="input"
                    value={v.role}
                    onChange={(e) => set({ role: e.target.value as SpeakerRole })}
                    style={{ fontSize: 12.5 }}
                    aria-label={`Role for ${r.name}`}
                  >
                    <option value="interviewer">Interviewer</option>
                    <option value="participant">Participant</option>
                    <option value="other">Other</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
