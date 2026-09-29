"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ColumnMenu } from "./ColumnMenu";
import type { LabelAxis, LabelMap } from "./labels";
import { LabelMenu } from "./LabelMenu";
import { ManageLabels } from "./ManageLabels";
import {
  applyView,
  columnsFor,
  countsFor,
  EMPTY_VIEW,
  sanitize,
  type Column,
  type InterviewRow,
  type View,
} from "./view";

export type { InterviewRow } from "./view";

// The remembered view per project, in this browser. Storage can be missing or
// blocked (private windows), so writes fall back to memory for the session.
const storageKey = (projectId: string) => `project-view:${projectId}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeSaved(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* kept in memory only */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The project's interviews. Sorting, grouping and filtering happen from the
 *  column headers; the sidebar counts whatever the table is grouped by (or,
 *  ungrouped, the organizations represented). Labels are one column of chips,
 *  set from a row or a selection with Label as…. The view is remembered per
 *  project in this browser. */
export function ProjectInterviews({
  projectId,
  rows,
  axes,
  labels,
  editor,
}: {
  projectId: string;
  rows: InterviewRow[];
  axes: LabelAxis[];
  labels: LabelMap;
  editor: boolean;
}) {
  const router = useRouter();
  const columns = useMemo(() => columnsFor(axes, labels), [axes, labels]);
  // Server render has no saved view; the browser's is read on hydration.
  const saved = useSyncExternalStore(
    subscribe,
    () => readSaved(storageKey(projectId)),
    () => null,
  );
  const view = useMemo<View>(() => {
    if (!saved) return EMPTY_VIEW;
    try {
      return JSON.parse(saved) as View;
    } catch {
      return EMPTY_VIEW;
    }
  }, [saved]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelMenu, setLabelMenu] = useState<{ ids: string[]; anchor: DOMRect } | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ sections: Column[]; anchor: DOMRect } | null>(null);
  const [managing, setManaging] = useState(false);

  const change = (v: View) => writeSaved(storageKey(projectId), JSON.stringify(v));

  // A remembered or stale setting for a removed label is dropped, not fatal.
  const live = sanitize(view, columns);
  const groups = applyView(rows, columns, live);
  const shownIds = groups.flatMap((g) => g.rows.map((r) => r.id));
  const col = (key: string) => columns.find((c) => c.key === key)!;
  const labelCols = columns.filter((c) => c.key.startsWith("label:"));
  const groupCol = live.group ? columns.find((c) => c.key === live.group) : undefined;
  const width = editor ? 8 : 7;

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  const allOn = (ids: string[]) => ids.length > 0 && ids.every((id) => selected.has(id));

  const header = (text: string, sections: Column[]) => {
    const keys = sections.map((s) => s.key);
    const sorted = live.sort && keys.includes(live.sort.key) ? live.sort.dir : null;
    const grouped = !!live.group && keys.includes(live.group);
    const filteredHere = keys.some((k) => live.filters[k]);
    return (
      <th>
        <button
          type="button"
          onClick={(e) => setColumnMenu({ sections, anchor: e.currentTarget.getBoundingClientRect() })}
          aria-haspopup="menu"
          style={{
            border: 0,
            background: "none",
            padding: 0,
            font: "inherit",
            color: "inherit",
            letterSpacing: "inherit",
            textTransform: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            gap: 5,
            alignItems: "center",
          }}
        >
          {text}
          {sorted && <span aria-label={`sorted ${sorted}`}>{sorted === "asc" ? "↑" : "↓"}</span>}
          {grouped && <span title="Grouped" style={{ color: "var(--color-accent-800)" }}>▤</span>}
          {filteredHere && <span title="Filtered" style={{ color: "var(--color-accent-800)" }}>●</span>}
          <span style={{ opacity: 0.45, fontSize: 9 }}>▾</span>
        </button>
      </th>
    );
  };

  // Chips describing the current view, each removable.
  const viewChips: { text: string; clear: () => void }[] = [
    ...(groupCol ? [{ text: `Grouped by ${groupCol.name.toLowerCase()}`, clear: () => change({ ...live, group: null }) }] : []),
    ...(live.sort
      ? [
          {
            text: `Sorted by ${col(live.sort.key).name.toLowerCase()}, ${col(live.sort.key).sortLabels[live.sort.dir === "asc" ? 0 : 1].toLowerCase()}`,
            clear: () => change({ ...live, sort: null }),
          },
        ]
      : []),
    ...Object.entries(live.filters).map(([k, keep]) => ({
      text: `${col(k).name}: ${keep.length ? keep.map((b) => col(k).label(b)).join(", ") : "none"}`,
      clear: () => {
        const filters = { ...live.filters };
        delete filters[k];
        change({ ...live, filters });
      },
    })),
  ];

  // Sidebar: counts for the grouped column, or organizations represented.
  const sideCounts = groupCol ? countsFor(rows, columns, live, groupCol.key) : null;
  const orgTally = new Map<string, number>();
  for (const r of rows) for (const o of r.organizations) orgTally.set(o, (orgTally.get(o) ?? 0) + 1);
  const orgs = [...orgTally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const noOrg = rows.filter((r) => !r.organizations.length).length;

  const row = (t: InterviewRow) => {
    const chips = axes.flatMap((a) => {
      const o = a.options.find((o) => o.id === labels[t.id]?.[a.id]);
      return o ? [{ axis: a, option: o }] : [];
    });
    return (
      <tr key={t.id}>
        {editor && (
          <td>
            <input
              type="checkbox"
              checked={selected.has(t.id)}
              onChange={(e) => toggle([t.id], e.target.checked)}
              aria-label={`Select ${t.title}`}
            />
          </td>
        )}
        <td>
          <Link href={`/transcripts/${t.id}`}>{t.title}</Link>
          <span className="meta" style={{ display: "block", fontSize: 11 }}>
            {t.source}
          </span>
        </td>
        <td>{t.participants.join(", ") || "—"}</td>
        <td className="meta" style={{ fontSize: 12.5 }}>
          {t.organizations.join(", ") || "—"}
        </td>
        <td>
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            {chips.map(({ axis, option }) => (
              <span
                key={axis.id}
                className={`tag ${live.group === `label:${axis.id}` ? "tag-accent" : "tag-neutral"}`}
                title={`${axis.name}: ${option.value}`}
                role={editor ? "button" : undefined}
                onClick={editor ? (e) => setLabelMenu({ ids: [t.id], anchor: e.currentTarget.getBoundingClientRect() }) : undefined}
                style={{ cursor: editor ? "pointer" : undefined }}
              >
                {option.value}
              </span>
            ))}
            {editor && (
              <button
                type="button"
                className="tag tag-outline"
                onClick={(e) => setLabelMenu({ ids: [t.id], anchor: e.currentTarget.getBoundingClientRect() })}
                style={{ cursor: "pointer", font: "inherit", fontSize: 11 }}
              >
                + label
              </button>
            )}
            {!editor && !chips.length && "—"}
          </span>
        </td>
        <td className="mono">{t.recordedOn ?? "—"}</td>
        <td className="mono">{t.durationMins ? `${t.durationMins} min` : "—"}</td>
        <td>
          <span className={`tag ${t.status === "coded" ? "tag-accent" : "tag-neutral"}`}>{t.status}</span>
        </td>
      </tr>
    );
  };

  if (!rows.length) {
    return (
      <div className="panel" style={{ padding: "var(--space-4)" }}>
        <p className="meta" style={{ margin: 0 }}>
          No interviews yet. Add transcripts here, or assign them from the library&apos;s Unassigned queue.
        </p>
      </div>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {/* Toolbar and selection bar span the full width, so the table and the
          sidebar card below them start at the same height. */}
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", minHeight: 28 }}>
        <span className="kicker">Interviews</span>
        {viewChips.map((c) => (
          <span key={c.text} className="tag tag-outline" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {c.text}
            <button
              type="button"
              onClick={c.clear}
              aria-label={`Remove: ${c.text}`}
              style={{ border: 0, background: "none", cursor: "pointer", padding: 0, fontSize: 12, color: "inherit" }}
            >
              ×
            </button>
          </span>
        ))}
        {viewChips.length > 1 && (
          <button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={() => change(EMPTY_VIEW)}>
            Reset view
          </button>
        )}
        {editor && (
          <button className="btn btn-ghost" style={{ fontSize: 11.5, marginLeft: "auto" }} onClick={() => setManaging(true)}>
            Manage labels
          </button>
        )}
      </div>

      {editor && selected.size > 0 && (
        <div
          className="panel"
          style={{
            padding: "var(--space-2) var(--space-3)",
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
            background: "var(--color-navy)",
            color: "#FFFFFF",
          }}
        >
          <strong style={{ fontSize: 12.5 }}>{selected.size} selected</strong>
          <button
            className="btn"
            style={{ fontSize: 12, color: "#FFFFFF", borderColor: "rgba(242,242,243,.45)" }}
            onClick={(e) => setLabelMenu({ ids: [...selected], anchor: e.currentTarget.getBoundingClientRect() })}
          >
            Label as… ▾
          </button>
          <button
            className="btn"
            style={{ fontSize: 12, color: "#FFFFFF", borderColor: "rgba(242,242,243,.25)", marginLeft: "auto" }}
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "flex-start" }}>
        <div className="panel" style={{ overflow: "auto", flex: "3 1 640px", minWidth: 0 }}>
          <table className="table">
            <thead>
              <tr>
                {editor && (
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={allOn(shownIds)}
                      onChange={(e) => toggle(shownIds, e.target.checked)}
                      aria-label="Select all shown"
                    />
                  </th>
                )}
                <th>Transcript</th>
                {header("Participant", [col("participant")])}
                {header("Organization", [col("organization")])}
                {header("Labels", labelCols)}
                {header("Recorded", [col("recorded")])}
                {header("Length", [col("length")])}
                {header("Status", [col("status")])}
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
                    onSelect={(on) => toggle(g.rows.map((r) => r.id), on)}
                  >
                    {g.rows.map(row)}
                  </GroupRows>
                ),
              )}
              {!shownIds.length && (
                <tr>
                  <td colSpan={width} className="meta">
                    No interviews match this view.{" "}
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => change(EMPTY_VIEW)}>
                      Reset view
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="card" style={{ gap: "var(--space-3)", flex: "1 1 240px", minWidth: 0 }}>
          {groupCol && sideCounts ? (
            <>
              <span className="card-kicker">By {groupCol.name.toLowerCase()}</span>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "4px var(--space-3)", fontSize: 13 }}>
                {sideCounts.map((c) => {
                  const keep = live.filters[groupCol.key];
                  const only = keep?.length === 1 && keep[0] === c.bucket;
                  return (
                    <div key={c.bucket} style={{ display: "contents" }}>
                      <dt>
                        <button
                          type="button"
                          onClick={() => {
                            const filters = { ...live.filters };
                            if (only) delete filters[groupCol.key];
                            else filters[groupCol.key] = [c.bucket];
                            change({ ...live, filters });
                          }}
                          title={only ? "Show all again" : `Show only ${c.label}`}
                          style={{
                            border: 0,
                            background: "none",
                            padding: 0,
                            font: "inherit",
                            textAlign: "left",
                            cursor: "pointer",
                            color: only ? "var(--color-accent-800)" : "inherit",
                            fontWeight: only ? 700 : 400,
                            opacity: keep && !keep.includes(c.bucket) ? 0.5 : 1,
                          }}
                        >
                          {c.label}
                        </button>
                      </dt>
                      <dd className="mono" style={{ margin: 0 }}>
                        {c.count}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                Click one to show only those; click it again to show all.
              </p>
            </>
          ) : (
            <>
              <span className="card-kicker">Organizations represented</span>
              {!orgs.length ? (
                <p className="meta" style={{ margin: 0 }}>
                  None recorded yet. Set a participant&apos;s organization from a transcript&apos;s Edit record.
                </p>
              ) : (
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "4px var(--space-3)", fontSize: 13 }}>
                  {orgs.map(([path, n]) => (
                    <div key={path} style={{ display: "contents" }}>
                      <dt>{path}</dt>
                      <dd className="mono" style={{ margin: 0 }}>
                        {n}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {noOrg > 0 && orgs.length > 0 && (
                <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                  {noOrg} interview{noOrg === 1 ? "" : "s"} without a participant organization.
                </p>
              )}
              <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                Group the table by any column to count by it here instead.
              </p>
            </>
          )}
        </aside>
      </div>

      {columnMenu && (
        <ColumnMenu
          columns={columns}
          sections={columnMenu.sections}
          rows={rows}
          view={live}
          anchor={columnMenu.anchor}
          onChange={change}
          onClose={() => setColumnMenu(null)}
        />
      )}
      {labelMenu && (
        <LabelMenu
          projectId={projectId}
          axes={axes}
          labels={labels}
          targetIds={labelMenu.ids}
          anchor={labelMenu.anchor}
          onClose={() => setLabelMenu(null)}
          onChanged={() => {
            if (labelMenu.ids.length > 1) setSelected(new Set());
            router.refresh();
          }}
        />
      )}
      {managing && <ManageLabels projectId={projectId} axes={axes} labels={labels} onClose={() => setManaging(false)} />}
    </section>
  );
}

/** A group's header row, then its rows. */
function GroupRows({
  label,
  count,
  width,
  selectable,
  allOn,
  onSelect,
  children,
}: {
  label: string;
  count: number;
  width: number;
  selectable: boolean;
  allOn: boolean;
  onSelect: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr style={{ background: "var(--color-bg-soft)" }}>
        {selectable && (
          <td>
            <input type="checkbox" checked={allOn} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select all in ${label}`} />
          </td>
        )}
        <td colSpan={selectable ? width - 1 : width}>
          <strong style={{ fontSize: 12.5 }}>{label}</strong>{" "}
          <span className="mono meta" style={{ fontSize: 11.5 }}>
            {count}
          </span>
        </td>
      </tr>
      {children}
    </>
  );
}
