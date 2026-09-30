"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/Drawer";
import { KIND_SUGGESTIONS, NewOrgForm, OrgCombobox } from "@/components/pickers";
import { KEEP, pillButton, SelectionBar, useClickOff } from "@/components/SelectionBar";
import { NewOrgDialog, OutlineDialog } from "./OrgCreate";
import { Notice } from "@/components/ui";
import { orgChain, orgLabel, withinOrg, type OrgOption } from "@/lib/directory";

/** Who's at an organization (its own, not its sub-organizations'): people
 *  whose current organization it is, and interviews with a speaker from it. */
export type OrgUsage = {
  people: { id: string; name: string; title: string | null }[];
  interviews: { id: string; title: string; date: string }[];
};

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
const EMPTY: OrgUsage = { people: [], interviews: [] };

async function orgAction(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/organizations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return b.error ?? `Request failed (${res.status}).`;
}

/** The organizations as a tree. Search keeps a match's parents in view;
 *  a row with sub-organizations folds. Clicking a row opens it in the
 *  drawer (rename, move, delete); ticking two or more offers a merge from
 *  the selection bar. */
export function OrganizationsView({ organizations, usage, editor }: { organizations: OrgOption[]; usage: Record<string, OrgUsage>; editor: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keepId, setKeepId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState<"one" | "outline" | null>(null);

  const byId = new Map(organizations.map((o) => [o.id, o]));
  const childrenOf = (id: string) => organizations.filter((o) => o.parentId === id);
  const depth = (o: OrgOption) => orgChain(o.id, organizations).length - 1;
  // Everyone and every interview at an organization or anywhere under it.
  const within = (id: string) => {
    const ids = withinOrg(id, organizations);
    const people = new Map<string, OrgUsage["people"][number]>();
    const interviews = new Map<string, OrgUsage["interviews"][number]>();
    for (const x of ids) {
      for (const p of usage[x]?.people ?? []) people.set(p.id, p);
      for (const i of usage[x]?.interviews ?? []) interviews.set(i.id, i);
    }
    return { people: [...people.values()], interviews: [...interviews.values()] };
  };

  // Search: matches, plus their parents so the tree still reads.
  const needle = q.trim().toLowerCase();
  const visible = new Set<string>();
  for (const o of organizations) {
    if (needle && ![o.name, o.shortName, o.kind].some((x) => x?.toLowerCase().includes(needle))) continue;
    for (const a of orgChain(o.id, organizations)) visible.add(a.id);
  }
  const hiddenByFold = (o: OrgOption) =>
    !needle &&
    orgChain(o.id, organizations)
      .slice(0, -1)
      .some((a) => folded.has(a.id));
  const rows = organizations.filter((o) => visible.has(o.id) && !hiddenByFold(o));
  const deepest = Math.max(0, ...organizations.map(depth));
  // Show the tree down to a level: fold everything with sub-organizations at
  // that depth (level 1 = top-level organizations only).
  const expandTo = (level: number) => setFolded(new Set(organizations.filter((o) => depth(o) >= level - 1 && childrenOf(o.id).length).map((o) => o.id)));

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
  useEffect(() => {
    if (!openId) return;
    const outside = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("aside[role=dialog], tr[data-org-row]")) return;
      setOpenId(null);
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [openId]);

  const picked = [...selected].map((id) => byId.get(id)).filter((o): o is OrgOption => !!o);
  const weight = (o: OrgOption) => (usage[o.id]?.people.length ?? 0) + (usage[o.id]?.interviews.length ?? 0) + childrenOf(o.id).length;
  const keep = picked.find((o) => o.id === keepId) ?? [...picked].sort((a, b) => weight(b) - weight(a))[0];
  const open = openId ? byId.get(openId) : undefined;

  async function run(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    const error = await orgAction(body);
    setBusy(false);
    if (error) {
      setNotice({ tone: "error", text: error });
      return false;
    }
    setNotice({ tone: "info", text: done });
    router.refresh();
    return true;
  }

  async function merge() {
    if (!keep) return;
    const others = picked.filter((o) => o.id !== keep.id);
    if (await run({ action: "merge", keepId: keep.id, mergeIds: others.map((o) => o.id) }, `Merged ${others.map((o) => o.name).join(", ")} into ${keep.name}.`)) {
      clearSelection();
      if (openId && others.some((o) => o.id === openId)) setOpenId(keep.id);
    }
  }

  const count = (n: number, all: number) => (
    <>
      {n}
      {all > n && (
        <span className="meta" style={{ fontSize: 11.5 }} title="Including sub-organizations">
          {" "}
          · {all} in all
        </span>
      )}
    </>
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", minHeight: 28 }}>
        <input className="input" placeholder="Search organizations" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300, fontSize: 12.5 }} />
        {!needle && deepest > 0 && (
          <span style={{ display: "inline-flex", gap: 2, alignItems: "center", fontSize: 11.5 }}>
            <span className="meta" style={{ marginRight: 4 }}>
              Show levels
            </span>
            {Array.from({ length: Math.min(deepest, 5) }, (_, i) => (
              <button key={i} className="btn btn-ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={() => expandTo(i + 1)} title={`Down to level ${i + 1}`}>
                {i + 1}
              </button>
            ))}
            <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={() => setFolded(new Set())}>
              All
            </button>
          </span>
        )}
        <span className="meta" style={{ marginLeft: "auto", fontSize: 12 }}>
          {organizations.length} organization{organizations.length === 1 ? "" : "s"}
        </span>
        {editor && (
          <>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setAdding("outline")}>
              Add from outline
            </button>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setAdding("one")}>
              New organization
            </button>
          </>
        )}
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="panel" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {editor && <th style={{ width: 28 }} aria-label="Select" />}
              <th>Organization</th>
              <th>People</th>
              <th>Interviews</th>
              <th>Sub-organizations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const kids = childrenOf(o.id);
              const all = within(o.id);
              const isOpen = openId === o.id;
              return (
                <tr
                  key={o.id}
                  {...KEEP}
                  data-org-row
                  onClick={(e) => !(e.target as Element).closest("input, button:not([data-open]), a") && setOpenId(isOpen ? null : o.id)}
                  style={{ cursor: "pointer", background: isOpen ? "var(--color-accent-tint-soft)" : undefined }}
                >
                  {editor && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(o.id);
                            else n.delete(o.id);
                            return n;
                          })
                        }
                        aria-label={`Select ${o.path}`}
                      />
                    </td>
                  )}
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, paddingLeft: depth(o) * 22 }}>
                      {kids.length > 0 && !needle ? (
                        <button
                          type="button"
                          onClick={() =>
                            setFolded((f) => {
                              const n = new Set(f);
                              if (n.has(o.id)) n.delete(o.id);
                              else n.add(o.id);
                              return n;
                            })
                          }
                          aria-label={folded.has(o.id) ? `Expand ${o.name}` : `Collapse ${o.name}`}
                          style={{ all: "unset", cursor: "pointer", width: 14, color: muted(50) }}
                        >
                          {folded.has(o.id) ? "▸" : "▾"}
                        </button>
                      ) : (
                        <span style={{ width: 14, color: muted(25) }}>{depth(o) > 0 ? "└" : ""}</span>
                      )}
                      <button type="button" data-open style={{ all: "unset", cursor: "pointer", fontWeight: depth(o) ? 500 : 700, color: "var(--color-accent-800)" }}>
                        {o.name}
                      </button>
                      {o.shortName && <span className="meta">({o.shortName})</span>}
                      {o.kind && (
                        <span className="tag tag-neutral" style={{ fontSize: 9.5, marginLeft: 4 }}>
                          {o.kind}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="mono">{count(usage[o.id]?.people.length ?? 0, all.people.length)}</td>
                  <td className="mono">{count(usage[o.id]?.interviews.length ?? 0, all.interviews.length)}</td>
                  <td className="mono">{kids.length || "—"}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={editor ? 5 : 4} className="meta">
                  {organizations.length ? "No organization matches." : "No organizations yet. They're added from Who's speaking when transcripts come in."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editor && selected.size > 0 && (
        <SelectionBar>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340 }}>{picked.map((o) => o.name).join(" + ")}</span>
          {picked.length > 1 ? (
            <>
              <span style={{ color: "var(--color-navy-muted)", flex: "none" }}>merge into</span>
              <select
                className="input"
                value={keep?.id ?? ""}
                onChange={(e) => setKeepId(e.target.value)}
                aria-label="Keep"
                style={{ width: "auto", maxWidth: 260, fontSize: 12, padding: "2px 8px", borderRadius: "var(--radius-pill)", flex: "none" }}
              >
                {picked.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.path}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                style={pillButton(true)}
                disabled={busy}
                onClick={merge}
                title="Their people, speakers and sub-organizations move to the one kept; the others are removed."
              >
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

      {adding === "one" && (
        <NewOrgDialog
          organizations={organizations}
          onClose={() => setAdding(null)}
          onCreated={(o) => {
            setAdding(null);
            setNotice({ tone: "info", text: `Added ${o.path}.` });
            router.refresh();
          }}
        />
      )}
      {adding === "outline" && (
        <OutlineDialog
          organizations={organizations}
          initialParentId={openId ?? ""}
          onClose={() => setAdding(null)}
          onDone={(r) => {
            setAdding(null);
            setNotice({ tone: "info", text: `Added ${r.created} organization${r.created === 1 ? "" : "s"}${r.reused ? `; ${r.reused} already existed and were reused` : ""}.` });
            router.refresh();
          }}
        />
      )}

      {open && (
        <OrgDrawer
          key={open.id}
          org={open}
          organizations={organizations}
          own={usage[open.id] ?? EMPTY}
          all={within(open.id)}
          usageOf={(id) => usage[id] ?? EMPTY}
          editor={editor}
          busy={busy}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          onSave={(changes, done) => run({ action: "update", orgId: open.id, changes }, done)}
          onAdded={(o) => {
            setNotice({ tone: "info", text: `Added ${o.path}.` });
            setFolded((f) => {
              const n = new Set(f);
              n.delete(open.id);
              return n;
            });
            router.refresh();
          }}
          onDelete={async () => {
            if (await run({ action: "delete", orgId: open.id }, `Deleted ${open.name}.`)) setOpenId(null);
          }}
        />
      )}
    </section>
  );
}

/** An organization in one place. Information: its name, where it sits
 *  (top level or under another), and its sub-organizations. People and
 *  Interviews: everyone and every interview there, sub-organizations
 *  included, each marked with where exactly. */
function OrgDrawer({
  org,
  organizations,
  own,
  all,
  usageOf,
  editor,
  busy,
  onClose,
  onOpen,
  onSave,
  onAdded,
  onDelete,
}: {
  org: OrgOption;
  organizations: OrgOption[];
  own: OrgUsage;
  all: OrgUsage;
  usageOf: (id: string) => OrgUsage;
  editor: boolean;
  busy: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onSave: (changes: { name?: string; parent_id?: string | null; short_name?: string | null; kind?: string | null }, done: string) => void;
  onAdded: (org: OrgOption) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [shortName, setShortName] = useState(org.shortName ?? "");
  const [kind, setKind] = useState(org.kind ?? "");
  const [addingSub, setAddingSub] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const kinds = [...new Set([...organizations.map((o) => o.kind).filter((k): k is string => !!k), ...KIND_SUGGESTIONS])];
  const chain = orgChain(org.id, organizations);
  const parent = chain.at(-2);
  const kids = organizations.filter((o) => o.parentId === org.id);
  // Anywhere but itself or its own sub-organizations.
  const inside = new Set(withinOrg(org.id, organizations));
  const renamed = name.trim() && name.trim() !== org.name;
  const unused = !kids.length && !own.people.length && !own.interviews.length;

  const info: [string, React.ReactNode][] = [
    [
      "Name",
      editor ? (
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renamed && onSave({ name: name.trim() }, `Renamed to ${name.trim()}.`)}
            style={{ fontSize: 12.5 }}
            aria-label="Name"
          />
          {renamed && (
            <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy} onClick={() => onSave({ name: name.trim() }, `Renamed to ${name.trim()}.`)}>
              Rename
            </button>
          )}
        </div>
      ) : (
        org.name
      ),
    ],
    [
      "Short name",
      editor ? (
        <input
          className="input"
          value={shortName}
          placeholder="e.g. OEL"
          onChange={(e) => setShortName(e.target.value)}
          onBlur={() => shortName.trim() !== (org.shortName ?? "") && onSave({ short_name: shortName.trim() || null }, "Short name saved.")}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          style={{ fontSize: 12.5 }}
          aria-label="Short name"
        />
      ) : (
        (org.shortName ?? "—")
      ),
    ],
    [
      "Kind",
      editor ? (
        <>
          <input
            className="input"
            list="org-kinds"
            value={kind}
            placeholder="e.g. Department, Division, Unit"
            onChange={(e) => setKind(e.target.value)}
            onBlur={() => kind.trim() !== (org.kind ?? "") && onSave({ kind: kind.trim() || null }, "Kind saved.")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            style={{ fontSize: 12.5 }}
            aria-label="Kind"
          />
          <datalist id="org-kinds">
            {kinds.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </>
      ) : (
        (org.kind ?? "—")
      ),
    ],
    [
      "Sits under",
      editor ? (
        <OrgCombobox
          organizations={organizations}
          value={org.parentId ?? ""}
          exclude={inside}
          disabled={busy}
          label="Sits under"
          noneLabel="Nothing — a top-level organization"
          onChange={(to) =>
            (to || null) !== org.parentId && onSave({ parent_id: to || null }, to ? `Moved under ${organizations.find((o) => o.id === to)?.path}.` : "Moved to the top level.")
          }
        />
      ) : parent ? (
        parent.path
      ) : (
        "Top level"
      ),
    ],
    [
      "Sub-organizations",
      kids.length ? (
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {kids.map((k) => (
            <button key={k.id} type="button" onClick={() => onOpen(k.id)} style={{ all: "unset", cursor: "pointer", color: "var(--color-accent-800)", fontWeight: 600 }}>
              {orgLabel(k)}
              {k.kind && (
                <span className="meta" style={{ fontWeight: 400 }}>
                  {" "}
                  · {k.kind}
                </span>
              )}
            </button>
          ))}
        </span>
      ) : (
        "None"
      ),
    ],
    ["People", all.people.length > own.people.length ? `${own.people.length} here · ${all.people.length} with sub-organizations` : String(own.people.length)],
    [
      "Interviews",
      all.interviews.length > own.interviews.length ? `${own.interviews.length} here · ${all.interviews.length} with sub-organizations` : String(own.interviews.length),
    ],
  ];

  // Which sub-organization someone (or an interview) is listed under, when
  // it isn't this one itself.
  const subOf = (kind: "people" | "interviews", id: string) =>
    [...new Set(withinOrg(org.id, organizations).filter((x) => x !== org.id && usageOf(x)[kind].some((i) => i.id === id)))]
      .map((x) => organizations.find((o) => o.id === x)?.name)
      .filter(Boolean)
      .join(", ");
  const ownPeople = new Set(own.people.map((p) => p.id));
  const ownInterviews = new Set(own.interviews.map((i) => i.id));

  return (
    <Drawer
      kicker={[org.kind ?? (parent ? "Sub-organization" : "Organization"), org.shortName].filter(Boolean).join(" · ")}
      title={org.name}
      description={
        chain.length > 1 ? (
          <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {chain.slice(0, -1).map((a) => (
              <span key={a.id} style={{ display: "inline-flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => onOpen(a.id)}
                  style={{ all: "unset", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
                  title={a.kind ?? undefined}
                >
                  {a.shortName ?? a.name}
                </button>
                <span style={{ opacity: 0.6 }}>›</span>
              </span>
            ))}
            <span>{org.shortName ?? org.name}</span>
          </span>
        ) : undefined
      }
      summary={`${all.people.length} ${all.people.length === 1 ? "person" : "people"} · ${all.interviews.length} interview${all.interviews.length === 1 ? "" : "s"}`}
      onClose={onClose}
    >
      <OrgSection title="Information">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "136px 1fr", gap: "10px var(--space-3)", alignItems: "center", fontSize: 13 }}>
          {info.map(([k, v]) => (
            <Fragment key={k}>
              <dt style={{ color: muted(60), fontSize: 12, alignSelf: "start", paddingTop: 2 }}>{k}</dt>
              <dd style={{ margin: 0, minWidth: 0 }}>{v}</dd>
            </Fragment>
          ))}
        </dl>
        {editor &&
          (addingSub ? (
            <NewOrgForm
              organizations={organizations}
              initialParentId={org.id}
              onCancel={() => setAddingSub(false)}
              onCreated={(o) => {
                setAddingSub(false);
                onAdded(o);
              }}
            />
          ) : (
            <button className="btn btn-secondary" style={{ alignSelf: "flex-start", fontSize: 12 }} onClick={() => setAddingSub(true)}>
              + Add a sub-organization
            </button>
          ))}
        {editor && unused && (
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: 12 }} disabled={busy} onClick={() => (confirming ? onDelete() : setConfirming(true))}>
            {confirming ? "Delete it?" : "Delete this organization"}
          </button>
        )}
        {editor && !unused && (
          <span className="meta" style={{ fontSize: 11.5 }}>
            In use, so it can&apos;t be deleted. To fold it into another, tick both in the table and merge.
          </span>
        )}
      </OrgSection>

      <OrgSection title="People">
        {!all.people.length && <span className="meta">No one lists it as their current organization.</span>}
        {[...all.people]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
              <Link href={`/people?person=${p.id}`} style={{ fontWeight: 600 }}>
                {p.name}
              </Link>
              <span className="meta" style={{ fontSize: 12 }}>
                {[p.title, !ownPeople.has(p.id) && subOf("people", p.id)].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
      </OrgSection>

      <OrgSection title="Interviews">
        {!all.interviews.length && <span className="meta">No interview has a speaker from here.</span>}
        {[...all.interviews]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
              <span className="mono" style={{ fontSize: 11, color: muted(55), flex: "none" }}>
                {i.date}
              </span>
              <Link href={`/transcripts/${i.id}`} style={{ fontWeight: 600 }}>
                {i.title}
              </Link>
              {!ownInterviews.has(i.id) && (
                <span className="meta" style={{ fontSize: 12 }}>
                  {subOf("interviews", i.id)}
                </span>
              )}
            </div>
          ))}
      </OrgSection>
    </Drawer>
  );
}

function OrgSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <h4 className="kicker" style={{ margin: 0, fontSize: 11, paddingBottom: 6, borderBottom: "1px solid var(--line-3)" }}>
        {title}
      </h4>
      {children}
    </section>
  );
}
