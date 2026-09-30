"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ColumnMenu } from "@/components/table/ColumnMenu";
import { GroupCounts, GroupRows, HeaderButton, ViewChips } from "@/components/table/parts";
import { useSavedView } from "@/components/table/useSavedView";
import type { LabelAxis, LabelMap } from "./labels";
import { LabelMenu } from "./LabelMenu";
import { ManageLabels } from "./ManageLabels";
import { applyView, columnsFor, countsFor, EMPTY_VIEW, sanitize, type Column, type InterviewRow } from "./view";

export type { InterviewRow } from "./view";

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
  const [view, change] = useSavedView(`project-view:${projectId}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelMenu, setLabelMenu] = useState<{ ids: string[]; anchor: DOMRect } | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ sections: Column[]; anchor: DOMRect } | null>(null);
  const [managing, setManaging] = useState(false);

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

  const header = (text: string, sections: Column[]) => (
    <HeaderButton text={text} sections={sections} view={live} onOpen={(sections, anchor) => setColumnMenu({ sections, anchor })} />
  );

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
        <ViewChips columns={columns} view={live} onChange={change} />
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
                {header("Organization", [col("organization"), col("topOrganization")])}
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
              <GroupCounts column={groupCol} counts={sideCounts} view={live} onChange={change} />
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
          emptyText="No labels yet. Tick some interviews and choose Label as…."
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
