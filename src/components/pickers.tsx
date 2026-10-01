"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { useRouter } from "next/navigation";
import type { ClientOption, Directory, OrgOption, PersonOption, ProjectOption } from "@/lib/directory";
import { addOrg, clientLabel, orgChain, orgLabel } from "@/lib/directory";
import type { SpeakerRole } from "@/lib/ingest/preview";

/** Client, then only that client's projects. The transcript stores the
 *  project; the client is implied by it. "New client…" and "New project…"
 *  create one in place (a new client goes straight on to its first project),
 *  so nothing has to be set up before an upload. */
export function ClientProjectPicker({
  directory,
  projectId,
  onChange,
  noneLabel = "Unassigned",
}: {
  directory: Pick<Directory, "clients" | "projects"> & Partial<Pick<Directory, "workspaceEditor" | "editableProjectIds">>;
  projectId: string;
  onChange: (projectId: string) => void;
  noneLabel?: string;
}) {
  // Someone from outside Harrington adds only to projects they edit: no
  // unassigned, no new clients or projects.
  const workspace = directory.workspaceEditor ?? true;
  const editable = directory.editableProjectIds ? new Set(directory.editableProjectIds) : null;
  const router = useRouter();
  // Made here, before the page's own lists catch up.
  const [madeClients, setMadeClients] = useState<ClientOption[]>([]);
  const [madeProjects, setMadeProjects] = useState<ProjectOption[]>([]);
  const clients = [...directory.clients.filter((c) => workspace || directory.projects.some((p) => p.clientId === c.id && (!editable || editable.has(p.id)))), ...madeClients.filter((c) => !directory.clients.some((d) => d.id === c.id))].sort((a, b) => a.name.localeCompare(b.name));
  const allProjects = [...directory.projects.filter((p) => !editable || editable.has(p.id)), ...madeProjects.filter((p) => !directory.projects.some((d) => d.id === p.id))];
  const implied = allProjects.find((p) => p.id === projectId)?.clientId ?? "";
  const [clientId, setClientId] = useState(implied);
  const projects = allProjects.filter((p) => p.clientId === clientId).sort((a, b) => a.name.localeCompare(b.name));
  const [making, setMaking] = useState<"client" | "project" | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = (what: "client" | "project") => {
    setMaking(what);
    setName("");
    setCode("");
    setError("");
  };

  async function create() {
    setBusy(true);
    setError("");
    const client = making === "client";
    const res = await fetch(client ? "/api/clients" : "/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(client ? { name, code } : { clientId, projectName: name }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Couldn't create it (${res.status}).`);
    if (client) {
      setMadeClients((c) => [...c, { id: body.id, name: body.name, code: body.code ?? null, slug: body.slug }]);
      setClientId(body.id);
      onChange("");
      start("project"); // a client needs a project before anything goes in it
    } else {
      setMadeProjects((p) => [...p, { id: body.id, name: name.trim(), clientId, path: body.path }]);
      onChange(body.id);
      setMaking(null);
    }
    router.refresh();
  }

  const form = (what: "client" | "project") => (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", gap: 4 }}>
        <input
          className="input"
          autoFocus
          placeholder={what === "client" ? "Client name" : `New project for ${clients.find((c) => c.id === clientId)?.name ?? "this client"}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              e.preventDefault();
              create();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setMaking(null);
            }
          }}
          style={{ fontSize: 12.5 }}
          aria-label={what === "client" ? "New client's name" : "New project's name"}
        />
        {what === "client" && (
          <input
            className="input"
            placeholder="Code (optional)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ fontSize: 12.5, width: 130, flex: "none" }}
            aria-label="Client code"
            title="Your short code for this client, as in Google Drive (optional)"
          />
        )}
      </span>
      <span style={{ display: "flex", gap: 4 }}>
        <button type="button" className="btn btn-primary" style={{ fontSize: 11.5 }} disabled={busy || !name.trim()} onClick={create}>
          {busy ? "Adding…" : what === "client" ? "Add client" : "Add project"}
        </button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5 }} disabled={busy} onClick={() => setMaking(null)}>
          Cancel
        </button>
      </span>
      {error && <span style={{ fontSize: 11, color: "var(--color-accent-800)" }}>{error}</span>}
    </span>
  );

  return (
    <>
      <Field label="Client">
        {making === "client" ? (
          form("client")
        ) : (
          <select
            className="input"
            value={clientId}
            onChange={(e) => {
              if (e.target.value === NEW) return start("client");
              setClientId(e.target.value);
              onChange("");
              setMaking(null);
            }}
          >
            <option value="">{workspace ? noneLabel : "Choose a client…"}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {clientLabel(c)}
              </option>
            ))}
            {workspace && <option value={NEW}>New client…</option>}
          </select>
        )}
      </Field>
      <Field label="Project">
        {making === "project" ? (
          form("project")
        ) : (
          <select className="input" value={projectId} disabled={!clientId || making === "client"} onChange={(e) => (e.target.value === NEW ? start("project") : onChange(e.target.value))}>
            <option value="">{clientId ? "Choose a project…" : "—"}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {clientId && workspace && <option value={NEW}>New project…</option>}
          </select>
        )}
      </Field>
    </>
  );
}

const NEW = "__new__";

/** Common names for an organization's layers, offered alongside any kinds
 *  already in use. */
export const KIND_SUGGESTIONS = ["Government", "Agency", "Department", "Division", "Office", "Bureau", "Section", "Unit", "Team", "Program", "Company", "Nonprofit", "Board"];

/** Does an organization match a search? Every word must appear somewhere in
 *  its path, the short names along it, or its kind. */
function orgMatches(o: OrgOption, organizations: OrgOption[], words: string[]): boolean {
  if (!words.length) return true;
  const hay = [o.path, o.kind ?? "", ...orgChain(o.id, organizations).map((a) => a.shortName ?? "")].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** A searchable organization field. Closed, it shows the chosen path; open,
 *  it lists the tree (indented) or, once you type, every organization whose
 *  path, short names or kind match — so "oel" finds Office of Early Learning
 *  however deep it sits. The last option starts a new organization with
 *  what was typed. */
export function OrgCombobox({
  organizations,
  value,
  onChange,
  onNew,
  noneLabel = "No organization",
  newLabel = "New organization…",
  exclude,
  compact = false,
  disabled = false,
  label = "Organization",
}: {
  organizations: OrgOption[];
  value: string;
  onChange: (id: string) => void;
  /** Offer "New organization…" and call this with what was typed. */
  onNew?: (typed: string) => void;
  noneLabel?: string;
  newLabel?: string;
  /** Organizations that can't be picked (and aren't listed). */
  exclude?: Set<string>;
  compact?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = organizations.find((o) => o.id === value);
  // Closed, a deep organization reads by its own name first, then the one it
  // sits in ("Early Childhood Assessment · OEL"); the full path is the tooltip.
  const shownAs = (o: OrgOption) => {
    const up = organizations.find((p) => p.id === o.parentId);
    return up ? `${o.name} · ${up.shortName ?? up.name}` : o.name;
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const depth = (o: OrgOption) => orgChain(o.id, organizations).length - 1;
  const matches = organizations.filter((o) => !exclude?.has(o.id) && orgMatches(o, organizations, words)).slice(0, 200);
  type Opt = { key: string; org?: OrgOption; action?: "none" | "new" };
  const options: Opt[] = [
    ...(words.length ? [] : [{ key: "__none__", action: "none" as const }]),
    ...matches.map((o) => ({ key: o.id, org: o })),
    ...(onNew ? [{ key: "__new__", action: "new" as const }] : []),
  ];

  const place = () => field.current && setRect(field.current.getBoundingClientRect());
  useEffect(() => {
    if (!open) return;
    const again = () => place();
    window.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    return () => {
      window.removeEventListener("scroll", again, true);
      window.removeEventListener("resize", again);
    };
  }, [open]);

  const pick = (o: Opt) => {
    setOpen(false);
    setQ("");
    field.current?.blur();
    if (o.action === "new") onNew?.(q.trim());
    else onChange(o.org?.id ?? "");
  };

  return (
    <span style={{ position: "relative", display: "block", minWidth: compact ? 0 : 200 }}>
      <input
        ref={field}
        className={compact ? "input cell-input" : "input"}
        value={open ? q : chosen ? shownAs(chosen) : ""}
        placeholder={open ? "Type to search" : noneLabel}
        disabled={disabled}
        title={chosen?.path}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onFocus={() => {
          place();
          setOpen(true);
          setQ("");
          setCursor(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (options[cursor]) pick(options[cursor]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            field.current?.blur();
          }
        }}
        style={{ fontSize: 12.5, textOverflow: "ellipsis" }}
      />
      {open && rect && (
        <div
          id={listId}
          role="listbox"
          data-keep-selection=""
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            top: rect.bottom + 4,
            // Kept on screen when the field sits near the right edge (a drawer).
            left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 320) - 8)),
            width: Math.max(rect.width, 320),
            maxHeight: 300,
            overflowY: "auto",
            zIndex: 80,
            background: "var(--color-surface)",
            border: "1px solid var(--line-4)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-lg)",
            padding: "4px 0",
          }}
        >
          {options.map((o, i) => (
            <div
              key={o.key}
              role="option"
              aria-selected={o.org?.id === value || (o.action === "none" && !value)}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(o)}
              style={{
                padding: "5px 10px",
                paddingLeft: o.org && !words.length ? 10 + depth(o.org) * 16 : 10,
                cursor: "pointer",
                fontSize: 12.5,
                background: i === cursor ? "var(--color-accent-tint)" : undefined,
                fontWeight: o.org?.id === value ? 700 : 400,
                display: "flex",
                gap: 6,
                alignItems: "baseline",
                borderTop: o.action === "new" ? "1px solid var(--line-2)" : undefined,
                color: o.action ? "var(--color-accent-800)" : undefined,
              }}
            >
              {o.action === "none" ? (
                noneLabel
              ) : o.action === "new" ? (
                q.trim() ? (
                  `${newLabel.replace(/…$/, "")}: “${q.trim()}”`
                ) : (
                  newLabel
                )
              ) : (
                <>
                  <span style={{ minWidth: 0 }}>
                    {words.length ? o.org!.path : o.org!.name}
                    {o.org!.shortName && <span className="meta"> ({o.org!.shortName})</span>}
                  </span>
                  {o.org!.kind && (
                    <span className="meta" style={{ fontSize: 10.5, marginLeft: "auto", textTransform: "uppercase", letterSpacing: "0.06em", flex: "none" }}>
                      {o.org!.kind}
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
          {!matches.length && words.length > 0 && (
            <div className="meta" style={{ padding: "5px 10px", fontSize: 12 }}>
              No organization matches.
            </div>
          )}
        </div>
      )}
    </span>
  );
}

/** A new organization: name, where it sits, and optionally its short name
 *  and kind. Returns the created organization (with its path). */
export function NewOrgForm({
  organizations,
  initialName = "",
  initialParentId = "",
  onCreated,
  onCancel,
}: {
  organizations: OrgOption[];
  initialName?: string;
  initialParentId?: string;
  onCreated: (org: OrgOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [parentId, setParentId] = useState(initialParentId);
  const [shortName, setShortName] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kindsId = useId();
  const kinds = [...new Set([...organizations.map((o) => o.kind).filter((k): k is string => !!k), ...KIND_SUGGESTIONS])];

  async function create() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parentId: parentId || null, shortName, kind }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't create it.");
    // Recompute the new row's path against the list it joins.
    onCreated(addOrg(organizations, body).find((o) => o.id === body.id)!);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <input
        className="input"
        placeholder="Organization name"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && create()}
        style={{ fontSize: 12.5 }}
        aria-label="New organization's name"
      />
      <OrgCombobox organizations={organizations} value={parentId} onChange={setParentId} noneLabel="Top level (under nothing)" label="Sits under" />
      <span style={{ display: "flex", gap: 6 }}>
        <input
          className="input"
          placeholder="Short name, e.g. OEL"
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          style={{ fontSize: 12.5 }}
          aria-label="Short name"
        />
        <input
          className="input"
          list={kindsId}
          placeholder="Kind, e.g. Division"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          style={{ fontSize: 12.5 }}
          aria-label="Kind"
        />
        <datalist id={kindsId}>
          {kinds.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </span>
      {error && <span style={{ fontSize: 11, color: "var(--color-accent-800)" }}>{error}</span>}
      <span style={{ display: "flex", gap: 4 }}>
        <button className="btn btn-primary" style={{ fontSize: 11.5 }} disabled={busy || !name.trim()} onClick={create}>
          {busy ? "Adding…" : "Add"}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 11.5 }} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}

/** Pick an organization (searchable), or create one in place. New
 *  organizations are reported upward so every picker sees them. */
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
  const [creating, setCreating] = useState<string | null>(null);
  if (creating !== null) {
    return (
      <NewOrgForm
        organizations={organizations}
        initialName={creating}
        onCancel={() => setCreating(null)}
        onCreated={(org) => {
          onCreated(org);
          onChange(org.id);
          setCreating(null);
        }}
      />
    );
  }
  return <OrgCombobox organizations={organizations} value={value} onChange={onChange} onNew={setCreating} compact={compact} disabled={disabled} />;
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
                  <td style={{ verticalAlign: "top", width: 210, maxWidth: 210 }}>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {r.name}
                    </span>
                    {r.detail && (
                      // Their first words, to tell who "Jen :)" is; two lines at most.
                      <div className="meta" style={{ fontSize: 11.5, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
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
                      style={{ fontSize: 12.5, minWidth: 128 }}
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
    const all = addOrg(organizations, body);
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
        // A level reads as what it is, when its kind is known (Department,
        // Division); otherwise Organization, then Sub-organization.
        const label = chosen?.kind ?? (level === 0 ? "Organization" : "Sub-organization");
        let field: React.ReactNode;
        if (!editable) {
          field = chosen ? orgLabel(chosen) : "—";
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
                  {orgLabel(o)}
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
