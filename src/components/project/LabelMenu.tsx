"use client";

import { useState } from "react";
import { MenuHeading, MenuItem, Popover } from "@/components/ui";
import { labelAction, type LabelAxis, type LabelMap } from "./labels";

/** "Label as…": every label and its options in one menu, for one row or a
 *  whole selection. Picking an option applies it; a new option or a whole new
 *  label can be typed in place and is applied as soon as it exists. */
export function LabelMenu({
  projectId,
  axes,
  labels,
  targetIds,
  anchor,
  onClose,
  onChanged,
}: {
  projectId: string;
  axes: LabelAxis[];
  labels: LabelMap;
  targetIds: string[];
  anchor: DOMRect;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null); // axis id, or "__axis__"
  const [draft, setDraft] = useState("");
  const [pendingAxis, setPendingAxis] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Every target has this option on this axis. */
  const allHave = (axisId: string, optionId: string) => targetIds.every((t) => labels[t]?.[axisId] === optionId);
  const anyOn = (axisId: string) => targetIds.some((t) => labels[t]?.[axisId]);

  async function apply(axisId: string, optionId: string | null) {
    setBusy(true);
    setError("");
    const { error: err } = await labelAction(projectId, { action: "apply", axisId, optionId, transcriptIds: targetIds });
    setBusy(false);
    if (err) return setError(err);
    onChanged();
    onClose();
  }

  async function createOption(axisId: string) {
    const value = draft.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    const { error: err, id } = await labelAction(projectId, { action: "addOption", axisId, value });
    setBusy(false);
    if (err || !id) return setError(err ?? "Couldn't add it.");
    setDraft("");
    setAdding(null);
    await apply(axisId, id);
  }

  async function createAxis() {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    const { error: err, id } = await labelAction(projectId, { action: "addAxis", name });
    setBusy(false);
    if (err || !id) return setError(err ?? "Couldn't add it.");
    // The new label has no options yet; ask for the first one straight away.
    setPendingAxis({ id, name });
    setDraft("");
    setAdding(id);
  }

  const shown = pendingAxis ? [...axes, { ...pendingAxis, options: [] }] : axes;
  const n = targetIds.length;

  const input = (placeholder: string, submit: () => void) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: "flex", gap: 4, padding: "2px 8px 6px" }}
    >
      <input
        className="input"
        autoFocus
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ fontSize: 12.5, padding: "4px 8px" }}
      />
      <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "2px 10px" }} disabled={busy || !draft.trim()}>
        Add
      </button>
    </form>
  );

  return (
    <Popover anchor={anchor} onClose={onClose} label="Label as">
      <div className="meta" style={{ padding: "2px 12px 6px", fontSize: 11.5 }}>
        Label {n} interview{n === 1 ? "" : "s"} as…
      </div>

      {shown.map((a) => (
        <div key={a.id} style={{ borderTop: "1px solid var(--line-1)", padding: "2px 0 4px" }}>
          <MenuHeading
            action={
              anyOn(a.id) && (
                <button
                  type="button"
                  onClick={() => apply(a.id, null)}
                  disabled={busy}
                  className="meta"
                  style={{ border: 0, background: "none", cursor: "pointer", fontSize: 11 }}
                >
                  Clear
                </button>
              )
            }
          >
            {a.name}
          </MenuHeading>
          {a.options.map((o) => (
            <MenuItem key={o.id} checked={allHave(a.id, o.id)} onClick={() => apply(a.id, o.id)} disabled={busy}>
              {o.value}
            </MenuItem>
          ))}
          {adding === a.id ? (
            input(`New ${a.name.toLowerCase()} option`, () => createOption(a.id))
          ) : (
            <MenuItem
              disabled={busy}
              onClick={() => {
                setDraft("");
                setAdding(a.id);
              }}
            >
              <span className="meta">+ New option…</span>
            </MenuItem>
          )}
        </div>
      ))}

      <div style={{ borderTop: "1px solid var(--line-1)", paddingTop: 4 }}>
        {adding === "__axis__" ? (
          input("New label, e.g. Department", createAxis)
        ) : (
          <MenuItem
            disabled={busy}
            onClick={() => {
              setDraft("");
              setAdding("__axis__");
            }}
          >
            <span className="meta">+ New label…</span>
          </MenuItem>
        )}
      </div>
      {error && <div style={{ padding: "4px 12px", fontSize: 11.5, color: "var(--color-accent-800)" }}>{error}</div>}
    </Popover>
  );
}
