"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Notice } from "@/components/ui";
import { labelAction, type LabelAxis, type LabelMap } from "./labels";

/** Set up a project's labels in one place: add labels and their options,
 *  rename them, remove them. (They can also be created on the fly from the
 *  Label as… menu while labelling.) */
export function ManageLabels({
  projectId,
  axes,
  labels,
  onClose,
}: {
  projectId: string;
  axes: LabelAxis[];
  labels: LabelMap;
  onClose: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newAxis, setNewAxis] = useState("");
  const [newOption, setNewOption] = useState<Record<string, string>>({});
  // A label just added: its option field takes focus so options follow straight on.
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const used = (axisId: string, optionId?: string) =>
    Object.values(labels).filter((l) => (optionId ? l[axisId] === optionId : !!l[axisId])).length;

  async function run(body: Record<string, unknown>): Promise<string | undefined> {
    setBusy(true);
    setError("");
    const { error: err, id } = await labelAction(projectId, body);
    setBusy(false);
    setConfirming(null);
    if (err) {
      setError(err);
      return undefined;
    }
    router.refresh();
    return id ?? "";
  }

  async function addOption(axisId: string) {
    const value = (newOption[axisId] ?? "").trim();
    if (!value) return;
    if ((await run({ action: "addOption", axisId, value })) !== undefined) {
      setNewOption((d) => ({ ...d, [axisId]: "" }));
    }
  }

  async function addAxis() {
    const name = newAxis.trim();
    if (!name) return;
    const id = await run({ action: "addAxis", name });
    if (id) {
      setNewAxis("");
      setJustAdded(id);
    }
  }

  /** A one-line add form: field and button. */
  const addForm = (
    value: string,
    onChange: (v: string) => void,
    onSubmit: () => void,
    placeholder: string,
    button: string,
    autoFocus = false,
  ) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: "flex", gap: 6 }}
    >
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 12.5, padding: "4px 8px" }}
      />
      <button className="btn btn-secondary" style={{ fontSize: 11.5, whiteSpace: "nowrap" }} disabled={busy || !value.trim()}>
        {button}
      </button>
    </form>
  );

  /** Rename on Enter or when the field loses focus, if it changed. */
  const renameField = (value: string, save: (v: string) => void, size = 13) => (
    <input
      key={value}
      className="input"
      defaultValue={value}
      disabled={busy}
      onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== value && save(e.target.value.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{ fontSize: size, padding: "4px 8px" }}
    />
  );

  const removeButton = (key: string, body: Record<string, unknown>, uses: number) => (
    <button
      className="btn btn-ghost"
      style={{ fontSize: 11.5, whiteSpace: "nowrap" }}
      disabled={busy}
      onClick={() => (confirming === key || uses === 0 ? run(body) : setConfirming(key))}
    >
      {confirming === key ? `Remove from ${uses}?` : "Remove"}
    </button>
  );

  return (
    <Dialog title="Manage labels" onClose={busy ? undefined : onClose}>
      <p className="meta" style={{ margin: 0 }}>
        {axes.length
          ? "Rename by editing a name. Removing a label or option also removes it from the interviews that have it."
          : "Labels group this project's interviews by whatever matters here — department, level, region. Add the first one below."}
      </p>

      {axes.map((a) => (
        <div key={a.id} className="panel" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {renameField(a.name, (name) => run({ action: "renameAxis", axisId: a.id, name }), 14)}
            <span className="meta mono" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
              {used(a.id)} labelled
            </span>
            {removeButton(`axis:${a.id}`, { action: "removeAxis", axisId: a.id }, used(a.id))}
          </div>
          {a.options.map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 16 }}>
              {renameField(o.value, (value) => run({ action: "renameOption", optionId: o.id, value }), 12.5)}
              <span className="meta mono" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                {used(a.id, o.id)}
              </span>
              {removeButton(`opt:${o.id}`, { action: "removeOption", optionId: o.id }, used(a.id, o.id))}
            </div>
          ))}
          <div style={{ paddingLeft: 16 }}>
            {addForm(
              newOption[a.id] ?? "",
              (v) => setNewOption((d) => ({ ...d, [a.id]: v })),
              () => addOption(a.id),
              `Add a ${a.name.toLowerCase()} option`,
              "Add option",
              justAdded === a.id,
            )}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker" style={{ fontSize: 10 }}>
          Add a label
        </span>
        {addForm(newAxis, setNewAxis, addAxis, "e.g. Department, Level, Region", "Add label", !axes.length)}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" onClick={onClose} disabled={busy}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
