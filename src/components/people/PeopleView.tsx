"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/Drawer";
import { OrgLevels, OrgPicker } from "@/components/pickers";
import { KEEP, pillButton, SelectionBar, useClickOff } from "@/components/SelectionBar";
import { ColumnMenu } from "@/components/table/ColumnMenu";
import { GroupRows, HeaderButton, ViewChips } from "@/components/table/parts";
import { useSavedView } from "@/components/table/useSavedView";
import { applyView, EMPTY_VIEW, sanitize, type Column } from "@/components/table/view";
import { Notice } from "@/components/ui";
import { withinOrg, withPaths, type OrgOption } from "@/lib/directory";
import { maybeSame, possibleDuplicates } from "@/lib/people/duplicates";
import { clientsOf, partOf, peopleColumns, type PersonRow } from "./view";

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
const toRow = (o: OrgOption) => ({ id: o.id, name: o.name, parent_id: o.parentId });
const PART: Record<string, string> = { participant: "Participant", interviewer: "Interviewer", both: "Both", other: "Other" };

async function peopleAction(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return b.error ?? `Request failed (${res.status}).`;
}

/** Everyone who speaks in an interview. Sorting, grouping and filtering
 *  happen from the column headers, as on a project's Interviews table, and
 *  the view is remembered in this browser. Organization and title are edited
 *  in place; clicking a row opens the person in the drawer; ticking two or
 *  more offers a merge from the selection bar, which clears on a click off
 *  the table or on Escape (after the drawer, if it's open). */
export function PeopleView({ people, organizations: initialOrgs, editor }: { people: PersonRow[]; organizations: OrgOption[]; editor: boolean }) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState(initialOrgs);
  const orgPath = useMemo(() => new Map(organizations.map((o) => [o.id, o.path])), [organizations]);
  const dupes = useMemo(() => possibleDuplicates(people), [people]);
  const columns = useMemo(() => peopleColumns(orgPath, dupes), [orgPath, dupes]);
  const [view, change] = useSavedView("people-view");
  const [q, setQ] = useState("");
  const [columnMenu, setColumnMenu] = useState<{ sections: Column<PersonRow>[]; anchor: DOMRect } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keepId, setKeepId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  // A click anywhere but the drawer or a person's row closes the drawer; a
  // row switches to that person instead.
  useEffect(() => {
    if (!openId) return;
    const outside = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("aside[role=dialog], tr[data-person-row]")) return;
      setOpenId(null);
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [openId]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);
  useClickOff(selected.size > 0, clearSelection);
  useEffect(() => {
    if (!openId && !selected.size) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openId) setOpenId(null);
      else clearSelection();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [openId, selected.size, clearSelection]);

  const live = sanitize(view, columns);
  const needle = q.trim().toLowerCase();
  const searched = needle ? people.filter((p) => [p.name, p.title, p.organizationId && orgPath.get(p.organizationId)].some((x) => x?.toLowerCase().includes(needle))) : people;
  const groups = applyView(searched, columns, live);
  const shownIds = groups.flatMap((g) => g.rows.map((r) => r.id));
  const col = (key: string) => columns.find((c) => c.key === key)!;
  const width = editor ? 8 : 7;

  const pickedPeople = [...selected].map((id) => people.find((p) => p.id === id)).filter((p): p is PersonRow => !!p);
  // Keep the fuller record unless told otherwise: most interviews, then the longest name.
  const fullest = [...pickedPeople].sort((a, b) => b.interviews.length - a.interviews.length || b.name.length - a.name.length)[0];
  const keep = pickedPeople.find((p) => p.id === keepId) ?? fullest;
  const open = people.find((p) => p.id === openId) ?? null;

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  const allOn = (ids: string[]) => ids.length > 0 && ids.every((id) => selected.has(id));

  async function run(body: Record<string, unknown>, done?: string): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    const error = await peopleAction(body);
    setBusy(false);
    if (error) {
      setNotice({ tone: "error", text: error });
      return false;
    }
    if (done) setNotice({ tone: "info", text: done });
    router.refresh();
    return true;
  }

  // Organization and title, edited in place.
  async function save(p: PersonRow, changes: { organization_id?: string | null; title?: string | null }) {
    setSaving(p.id);
    await run({ action: "update", personId: p.id, changes });
    setSaving(null);
  }

  async function merge() {
    if (!keep) return;
    const others = pickedPeople.filter((p) => p.id !== keep.id);
    const ok = await run({ action: "merge", keepId: keep.id, mergeIds: others.map((p) => p.id) }, `Merged ${others.map((p) => p.name).join(", ")} into ${keep.name}.`);
    if (ok) setSelected(new Set());
  }

  const header = (text: string, sections: Column<PersonRow>[]) => (
    <HeaderButton text={text} sections={sections} view={live} onOpen={(sections, anchor) => setColumnMenu({ sections, anchor })} />
  );

  const row = (p: PersonRow) => {
    const isOpen = openId === p.id;
    return (
      <tr
        key={p.id}
        {...KEEP}
        data-person-row
        // The whole row opens the person; its own controls keep their clicks.
        onClick={(e) => !(e.target as Element).closest("input, select, button:not([data-open]), a, label") && setOpenId(isOpen ? null : p.id)}
        style={{ cursor: "pointer", background: isOpen ? "var(--color-accent-tint-soft)" : undefined, opacity: saving === p.id ? 0.6 : 1 }}
      >
        {editor && (
          <td>
            <input type="checkbox" checked={selected.has(p.id)} onChange={(e) => toggle([p.id], e.target.checked)} aria-label={`Select ${p.name}`} />
          </td>
        )}
        <td>
          <button
            type="button"
            data-open
            title="Open their details"
            style={{ all: "unset", cursor: "pointer", fontWeight: 600, color: "var(--color-accent-800)", textDecoration: isOpen ? "underline" : undefined }}
          >
            {p.name}
          </button>
          {dupes.has(p.id) && (
            <span className="tag tag-outline" style={{ fontSize: 10, marginLeft: 8 }} title="Shares a first name with someone else here">
              possible duplicate
            </span>
          )}
        </td>
        <td style={{ minWidth: 210 }}>
          {editor ? (
            <OrgPicker
              compact
              organizations={organizations}
              value={p.organizationId ?? ""}
              disabled={saving === p.id}
              onChange={(id) => id !== (p.organizationId ?? "") && save(p, { organization_id: id || null })}
              onCreated={(org) => setOrganizations((all) => withPaths([...all.map(toRow), toRow(org)]))}
            />
          ) : (
            (p.organizationId && orgPath.get(p.organizationId)) || "—"
          )}
        </td>
        <td style={{ minWidth: 150 }}>
          {editor ? <TitleCell key={p.title ?? ""} value={p.title ?? ""} disabled={saving === p.id} onSave={(t) => save(p, { title: t || null })} /> : (p.title ?? "—")}
        </td>
        <td>{PART[partOf(p)] ?? "—"}</td>
        <td className="meta" style={{ fontSize: 12.5 }}>
          {clientsOf(p).length
            ? clientsOf(p).map((c) => (
                <span key={c} style={{ display: "block", whiteSpace: "nowrap" }}>
                  {c}
                </span>
              ))
            : "—"}
        </td>
        <td className="mono">{p.interviews.length}</td>
        <td className="mono" style={{ whiteSpace: "nowrap" }}>
          {p.interviews[0]?.date ?? "—"}
        </td>
      </tr>
    );
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", minHeight: 28 }}>
        <input className="input" placeholder="Search names, organizations, titles" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300, fontSize: 12.5 }} />
        <ViewChips columns={columns} view={live} onChange={change} />
        {dupes.size > 0 && !live.filters.duplicate && (
          <button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={() => change({ ...live, filters: { ...live.filters, duplicate: ["yes"] } })}>
            Show {dupes.size} possible duplicates
          </button>
        )}
        <span className="meta" style={{ marginLeft: "auto", fontSize: 12 }}>
          {shownIds.length} of {people.length} people
        </span>
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="panel" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {editor && (
                <th style={{ width: 28 }}>
                  <input type="checkbox" checked={allOn(shownIds)} onChange={(e) => toggle(shownIds, e.target.checked)} aria-label="Select all shown" />
                </th>
              )}
              {header("Name", [col("name"), col("duplicate")])}
              {header("Organization", [col("organization"), col("topOrganization")])}
              {header("Title", [col("title")])}
              {header("Part", [col("part")])}
              {header("Clients", [col("clients")])}
              {header("Interviews", [col("interviews")])}
              {header("Latest", [col("latest")])}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.bucket === null ? (
                g.rows.map(row)
              ) : (
                <GroupRows
                  key={g.bucket}
                  label={g.label}
                  count={g.rows.length}
                  width={width}
                  selectable={editor}
                  allOn={allOn(g.rows.map((r) => r.id))}
                  onSelect={(on) =>
                    toggle(
                      g.rows.map((r) => r.id),
                      on,
                    )
                  }
                >
                  {g.rows.map(row)}
                </GroupRows>
              ),
            )}
            {!shownIds.length && (
              <tr>
                <td colSpan={width} className="meta">
                  {people.length ? "No one matches." : "No people yet. They're added as transcripts come in."}{" "}
                  {people.length > 0 && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        setQ("");
                        change(EMPTY_VIEW);
                      }}
                    >
                      Reset view
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editor && selected.size > 0 && (
        <SelectionBar>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{pickedPeople.map((p) => p.name).join(" + ")}</span>
          {pickedPeople.length > 1 ? (
            <>
              <span style={{ color: "var(--color-navy-muted)", flex: "none" }}>merge into</span>
              <select
                className="input"
                value={keep?.id ?? ""}
                onChange={(e) => setKeepId(e.target.value)}
                aria-label="Keep"
                style={{ width: "auto", fontSize: 12, padding: "2px 8px", borderRadius: "var(--radius-pill)", flex: "none" }}
              >
                {pickedPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn" style={pillButton(true)} disabled={busy} onClick={merge} title="Their interviews move over; the others are removed.">
                Merge
              </button>
            </>
          ) : (
            <span style={{ color: "var(--color-navy-muted)", flex: "none" }}>tick another to merge</span>
          )}
          <button className="btn" onClick={clearSelection} aria-label="Clear selection" style={{ ...pillButton(false), padding: "3px 10px" }}>
            Clear
          </button>
        </SelectionBar>
      )}

      {columnMenu && (
        <ColumnMenu columns={columns} sections={columnMenu.sections} rows={searched} view={live} anchor={columnMenu.anchor} onChange={change} onClose={() => setColumnMenu(null)} />
      )}

      {open && (
        <PersonDrawer
          key={open.id}
          person={open}
          namesakes={people.filter((o) => o.id !== open.id && maybeSame(o.name, open.name))}
          organizations={organizations}
          orgPath={orgPath}
          editor={editor}
          busy={busy || saving === open.id}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          onSave={(changes) => save(open, changes)}
          onOrgCreated={(org) => setOrganizations((all) => withPaths([...all.map(toRow), toRow(org)]))}
          onShowOrg={(org) => {
            // A top-level organization: everyone under it. A sub-organization:
            // it and anything within it.
            const filters = { ...live.filters };
            delete filters.organization;
            delete filters.topOrganization;
            if (org.parentId) filters.organization = withinOrg(org.id, organizations);
            else filters.topOrganization = [org.name];
            change({ ...live, filters });
          }}
          onDelete={async () => {
            if (await run({ action: "delete", personId: open.id }, `Deleted ${open.name}.`)) setOpenId(null);
          }}
        />
      )}
    </section>
  );
}

/** A title edited in place: saved on Enter or when the field loses focus. */
function TitleCell({ value, disabled, onSave, compact = true }: { value: string; disabled: boolean; onSave: (v: string) => void; compact?: boolean }) {
  const [draft, setDraft] = useState(value);
  const commit = () => draft.trim() !== value && onSave(draft.trim());
  return (
    <input
      className={compact ? "input cell-input" : "input"}
      value={draft}
      placeholder="Add a title"
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      style={{ fontSize: 12.5 }}
      aria-label="Title"
    />
  );
}

/** A section of the person drawer, under a plain heading. */
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h4 className="kicker" style={{ margin: 0, fontSize: 11, paddingBottom: 6, borderBottom: "1px solid var(--line-3)" }}>
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Everything about a person in one place. Information: name, current
 *  organization and title (editable), their part, clients, interview count,
 *  latest interview, and anyone they might be a duplicate of. Projects:
 *  every interview they're in, by client and project, with what was true at
 *  the time and how the export wrote their name. */
function PersonDrawer({
  person,
  namesakes,
  organizations,
  orgPath,
  editor,
  busy,
  onClose,
  onOpen,
  onSave,
  onOrgCreated,
  onShowOrg,
  onDelete,
}: {
  person: PersonRow;
  namesakes: PersonRow[];
  organizations: OrgOption[];
  orgPath: Map<string, string>;
  editor: boolean;
  busy: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onSave: (changes: { name?: string; organization_id?: string | null; title?: string | null }) => void;
  onOrgCreated: (org: OrgOption) => void;
  onShowOrg: (org: OrgOption) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [confirming, setConfirming] = useState(false);
  const n = person.interviews.length;
  const clients = clientsOf(person);
  const byProject = new Map<string, PersonRow["interviews"]>();
  for (const iv of person.interviews) {
    const k = iv.project ? `${iv.client ?? "No client"} › ${iv.project}` : "Unassigned";
    byProject.set(k, [...(byProject.get(k) ?? []), iv]);
  }
  const current = [person.title, person.organizationId && orgPath.get(person.organizationId)].filter(Boolean).join(" · ");
  const renamed = name.trim() && name.trim() !== person.name;

  const info: [string, React.ReactNode][] = [
    [
      "Name",
      editor ? (
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renamed && onSave({ name: name.trim() })}
            style={{ fontSize: 12.5 }}
            aria-label="Name"
          />
          {renamed && (
            <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy} onClick={() => onSave({ name: name.trim() })}>
              Rename
            </button>
          )}
        </div>
      ) : (
        person.name
      ),
    ],
    [
      "Title",
      editor ? (
        <TitleCell key={person.title ?? ""} compact={false} value={person.title ?? ""} disabled={busy} onSave={(t) => onSave({ title: t || null })} />
      ) : (
        (person.title ?? "—")
      ),
    ],
    ["Part", PART[partOf(person)] ?? "In no interview"],
    ["Clients", clients.length ? clients.join(", ") : "—"],
    ["Interviews", String(n)],
    ["Latest", person.interviews[0]?.date ?? "—"],
  ];
  if (namesakes.length) {
    info.push([
      "Possible duplicate of",
      <span key="dupes" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {namesakes.map((o) => (
          <button key={o.id} type="button" onClick={() => onOpen(o.id)} style={{ all: "unset", cursor: "pointer", color: "var(--color-accent-800)", fontWeight: 600 }}>
            {o.name}
            <span className="meta" style={{ fontWeight: 400 }}>
              {" "}
              · {o.interviews.length} interview{o.interviews.length === 1 ? "" : "s"}
            </span>
          </button>
        ))}
        {editor && (
          <span className="meta" style={{ fontSize: 11.5 }}>
            Tick both in the table to merge them.
          </span>
        )}
      </span>,
    ]);
  }

  return (
    <Drawer
      kicker={`Person · ${PART[partOf(person)] ?? "in no interview"}`}
      title={person.name}
      description={current || undefined}
      summary={n ? `${n} interview${n === 1 ? "" : "s"} · latest ${person.interviews[0].date}` : "In no interview"}
      onClose={onClose}
    >
      <DrawerSection title="Information">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "136px 1fr", gap: "10px var(--space-3)", alignItems: "center", fontSize: 13 }}>
          {info.map(([k, v], i) => (
            <Fragment key={k}>
              <div style={{ display: "contents" }}>
                <dt style={{ color: muted(60), fontSize: 12, alignSelf: "start", paddingTop: 2 }}>{k}</dt>
                <dd style={{ margin: 0, minWidth: 0 }}>{v}</dd>
              </div>
              {/* Organization, then its sub-organizations, right after the name. */}
              {i === 0 && (
                <OrgLevels
                  organizations={organizations}
                  value={person.organizationId ?? ""}
                  editable={editor}
                  disabled={busy}
                  onChange={(id) => id !== (person.organizationId ?? "") && onSave({ organization_id: id || null })}
                  onCreated={onOrgCreated}
                  onShow={onShowOrg}
                />
              )}
            </Fragment>
          ))}
        </dl>
        {editor && !n && (
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: 12 }} disabled={busy} onClick={() => (confirming ? onDelete() : setConfirming(true))}>
            {confirming ? "Delete them?" : "Delete this person"}
          </button>
        )}
      </DrawerSection>

      <DrawerSection title="Projects">
        {!n && <span className="meta">In no interview yet.</span>}
        {[...byProject].map(([where, ivs]) => (
          <div key={where} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)" }}>{where}</div>
            {ivs.map((iv) => (
              <div key={iv.id} style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12, borderLeft: "2px solid var(--color-accent-200)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span className="mono" style={{ fontSize: 11, color: muted(55), flex: "none" }}>
                    {iv.date}
                  </span>
                  <Link href={`/transcripts/${iv.id}`} style={{ fontSize: 13, fontWeight: 600 }}>
                    {iv.title}
                  </Link>
                </div>
                <span style={{ fontSize: 12, color: muted(65) }}>
                  {[PART[iv.role] ?? iv.role, iv.titleThen, iv.orgThen && orgPath.get(iv.orgThen)].filter(Boolean).join(" · ")}
                </span>
                <span className="meta" style={{ fontSize: 11.5 }} title="As the export wrote their name">
                  Written as {iv.names.map((x) => `“${x}”`).join(", ")}
                </span>
              </div>
            ))}
          </div>
        ))}
      </DrawerSection>
    </Drawer>
  );
}
