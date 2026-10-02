"use client";

import { EMPTY_VIEW, type Column, type Count, type View } from "./view";

/** A column header that opens its sort / group / filter menu, marked when
 *  it's sorted (↑↓), grouped (▤) or filtered (●). */
export function HeaderButton<R>({
  text,
  sections,
  view,
  onOpen,
}: {
  text: string;
  sections: Column<R>[];
  view: View;
  onOpen: (sections: Column<R>[], anchor: DOMRect) => void;
}) {
  const keys = sections.map((s) => s.key);
  const sorted = view.sort && keys.includes(view.sort.key) ? view.sort.dir : null;
  const grouped = !!view.group && keys.includes(view.group);
  const filteredHere = keys.some((k) => view.filters[k]);
  return (
    <th>
      <button
        type="button"
        onClick={(e) => onOpen(sections, e.currentTarget.getBoundingClientRect())}
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
}

/** Chips describing the current view, each removable, and Reset view when
 *  there's more than one. */
export function ViewChips<R>({ columns, view, onChange }: { columns: Column<R>[]; view: View; onChange: (v: View) => void }) {
  const col = (key: string) => columns.find((c) => c.key === key)!;
  const groupCol = view.group ? columns.find((c) => c.key === view.group) : undefined;
  const chips: { text: string; clear: () => void }[] = [
    ...(groupCol ? [{ text: `Grouped by ${groupCol.name.toLowerCase()}`, clear: () => onChange({ ...view, group: null }) }] : []),
    ...(view.sort
      ? [
          {
            text: `Sorted by ${col(view.sort.key).name.toLowerCase()}, ${col(view.sort.key).sortLabels[view.sort.dir === "asc" ? 0 : 1].toLowerCase()}`,
            clear: () => onChange({ ...view, sort: null }),
          },
        ]
      : []),
    ...Object.entries(view.filters).map(([k, keep]) => ({
      text: `${col(k).name}: ${keep.length ? keep.map((b) => col(k).label(b)).join(", ") : "none"}`,
      clear: () => {
        const filters = { ...view.filters };
        delete filters[k];
        onChange({ ...view, filters });
      },
    })),
  ];
  return (
    <>
      {chips.map((c) => (
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
      {chips.length > 1 && (
        <button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={() => onChange(EMPTY_VIEW)}>
          Reset view
        </button>
      )}
    </>
  );
}

/** A group's header row, then its rows. */
export function GroupRows({
  label,
  count,
  width,
  selectable,
  allOn,
  onSelect,
  extra,
  children,
}: {
  label: string;
  count: number;
  /** Anything else the heading should say (a group's total, say). */
  extra?: React.ReactNode;
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
          {extra}
        </td>
      </tr>
      {children}
    </>
  );
}

/** Sidebar counts for one column; clicking a value shows only it, clicking
 *  it again shows all. */
export function GroupCounts<R>({ column, counts, view, onChange }: { column: Column<R>; counts: Count[]; view: View; onChange: (v: View) => void }) {
  const keep = view.filters[column.key];
  return (
    <>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "4px var(--space-3)", fontSize: 13 }}>
        {counts.map((c) => {
          const only = keep?.length === 1 && keep[0] === c.bucket;
          return (
            <div key={c.bucket} style={{ display: "contents" }}>
              <dt>
                <button
                  type="button"
                  onClick={() => {
                    const filters = { ...view.filters };
                    if (only) delete filters[column.key];
                    else filters[column.key] = [c.bucket];
                    onChange({ ...view, filters });
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
  );
}
