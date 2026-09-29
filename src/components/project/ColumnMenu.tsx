"use client";

import { MenuHeading, MenuItem, Popover } from "@/components/ui";
import { countsFor, type Column, type InterviewRow, type View } from "./view";

/** A column header's menu: sort either way, group by it, and filter its
 *  values. The Labels header passes one column per label axis, each as its
 *  own section. */
export function ColumnMenu({
  columns,
  sections,
  rows,
  view,
  anchor,
  onChange,
  onClose,
}: {
  /** Every column, for filter counts. */
  columns: Column[];
  /** The column(s) this header controls. */
  sections: Column[];
  rows: InterviewRow[];
  view: View;
  anchor: DOMRect;
  onChange: (v: View) => void;
  onClose: () => void;
}) {
  const setFilter = (key: string, keep: string[] | null) => {
    const filters = { ...view.filters };
    if (keep === null) delete filters[key];
    else filters[key] = keep;
    onChange({ ...view, filters });
  };

  return (
    <Popover anchor={anchor} onClose={onClose} label={sections.map((s) => s.name).join(", ")} width={260}>
      {!sections.length && (
        <p className="meta" style={{ margin: 0, padding: "4px 12px", fontSize: 12 }}>
          No labels yet. Tick some interviews and choose Label as….
        </p>
      )}
      {sections.map((col, i) => {
        const counts = countsFor(rows, columns, view, col.key);
        const keep = view.filters[col.key];
        const isOn = (b: string) => !keep || keep.includes(b);
        const sorted = view.sort?.key === col.key ? view.sort.dir : null;
        return (
          <div key={col.key} style={{ borderTop: i ? "1px solid var(--line-1)" : undefined, paddingBottom: 4 }}>
            {sections.length > 1 && <MenuHeading>{col.name}</MenuHeading>}
            <MenuItem
              checked={sorted === "asc"}
              onClick={() => onChange({ ...view, sort: sorted === "asc" ? null : { key: col.key, dir: "asc" } })}
            >
              Sort {col.sortLabels[0]}
            </MenuItem>
            <MenuItem
              checked={sorted === "desc"}
              onClick={() => onChange({ ...view, sort: sorted === "desc" ? null : { key: col.key, dir: "desc" } })}
            >
              Sort {col.sortLabels[1]}
            </MenuItem>
            <MenuItem
              checked={view.group === col.key}
              onClick={() => onChange({ ...view, group: view.group === col.key ? null : col.key })}
            >
              Group by {col.name.toLowerCase()}
            </MenuItem>

            <MenuHeading
              action={
                keep && (
                  <button
                    type="button"
                    className="meta"
                    onClick={() => setFilter(col.key, null)}
                    style={{ border: 0, background: "none", cursor: "pointer", fontSize: 11 }}
                  >
                    Show all
                  </button>
                )
              }
            >
              Show
            </MenuHeading>
            {counts.map((c) => (
              <div key={c.bucket} style={{ display: "flex", alignItems: "center" }}>
                <MenuItem
                  checked={isOn(c.bucket)}
                  onClick={() => {
                    const current = keep ?? counts.map((x) => x.bucket);
                    const next = isOn(c.bucket) ? current.filter((b) => b !== c.bucket) : [...current, c.bucket];
                    setFilter(col.key, next.length === counts.length ? null : next);
                  }}
                >
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span className="mono meta" style={{ fontSize: 11.5 }}>
                    {c.count}
                  </span>
                </MenuItem>
                <button
                  type="button"
                  className="meta"
                  title={`Show only ${c.label}`}
                  onClick={() => setFilter(col.key, [c.bucket])}
                  style={{ border: 0, background: "none", cursor: "pointer", fontSize: 11, padding: "0 10px 0 0" }}
                >
                  only
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </Popover>
  );
}
