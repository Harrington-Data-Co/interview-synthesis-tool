"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";
import type { Directory } from "@/lib/directory";
import { withBase } from "@/lib/basePath";

const CODE_TYPES = ["Pain", "Step", "Tool", "Goal", "Constraint", "Question", "Quote", "Stakeholder"];
const SOURCE_LABEL: Record<string, string> = { themes: "Themes" };

export type TemplateRow = {
  id: string;
  name: string;
  scope: string | null;
  projectId: string | null;
  copiedFromId: string | null;
  notes: number;
  sections: { id: string; name: string; requires: string[]; note: string | null }[];
};

export async function templateAction(body: Record<string, unknown>): Promise<{ error: string | null; id?: string }> {
  const res = await fetch(withBase("/api/templates"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).` };
  return { error: null, id: b.id };
}

/** The template list (library, then projects) and the selected template's
 *  sections. Names and guidance save when the field loses focus. */
export function TemplatesEditor({
  kind = "note",
  templates,
  selectedId,
  directory,
  editor,
}: {
  kind?: "note" | "memo" | "deck";
  templates: TemplateRow[];
  selectedId: string | null;
  directory: Pick<Directory, "clients" | "projects">;
  editor: boolean;
}) {
  // Memo and deck sections can also fill from confirmed themes.
  const memo = kind === "memo" || kind === "deck";
  const TYPES = memo ? ["themes", ...CODE_TYPES] : CODE_TYPES;
  const starterName = kind === "deck" ? "Findings readout" : memo ? "Findings memo" : "Discovery interview";
  const uses = kind === "deck" ? "deck" : memo ? "memo" : "note";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");
  const [addTo, setAddTo] = useState("");

  const library = templates.filter((t) => !t.projectId);
  const selected = templates.find((t) => t.id === selectedId) ?? library[0] ?? templates[0];
  const projectName = (id: string) => {
    const p = directory.projects.find((x) => x.id === id);
    const c = p && directory.clients.find((x) => x.id === p.clientId);
    return p ? `${c ? `${c.name} · ` : ""}${p.name}` : "Unknown project";
  };
  const byProject = directory.projects
    .map((p) => ({ id: p.id, name: projectName(p.id), templates: templates.filter((t) => t.projectId === p.id) }))
    .filter((g) => g.templates.length);
  const origin = selected?.copiedFromId ? templates.find((t) => t.id === selected.copiedFromId) : undefined;

  async function run(body: Record<string, unknown>, then?: (id?: string) => void) {
    setBusy(true);
    setError("");
    const { error: err, id } = await templateAction({ ...body, kind });
    setBusy(false);
    setConfirming(null);
    if (err) return setError(err);
    then?.(id);
    router.refresh();
  }
  const base = memo ? `/templates?kind=${kind}&` : "/templates?";
  const go = (id?: string) => id && router.push(`${base}t=${id}`);

  const listItem = (t: TemplateRow) => (
    <Link
      key={t.id}
      href={`${base}t=${t.id}`}
      className="card"
      style={{
        gap: 2,
        textDecoration: "none",
        color: "inherit",
        outline: selected?.id === t.id ? "2px solid var(--color-accent)" : undefined,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</span>
      <span className="meta" style={{ fontSize: 11.5 }}>
        {t.sections.length} section{t.sections.length === 1 ? "" : "s"}
        {t.notes ? ` · ${t.notes} ${uses}${t.notes === 1 ? "" : "s"}` : ""}
      </span>
    </Link>
  );

  // Uncontrolled fields keyed on their saved value (keys are passed directly on
  // each field), so a save that comes back from the server resets them.
  const saveOnBlur = (value: string, save: (v: string) => void, props: Record<string, unknown> = {}) => ({
    defaultValue: value,
    disabled: !editor || busy,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value.trim();
      if (v !== value.trim()) save(v);
    },
    ...props,
  });

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)", alignItems: "flex-start" }}>
      <aside style={{ flex: "0 1 280px", minWidth: 220, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="kicker">Library</span>
        {library.map(listItem)}
        {!library.length && (
          <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
            The library is empty.
          </p>
        )}
        {editor && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {!templates.some((t) => t.name === starterName && !t.projectId) && (
              <button className="btn btn-primary" disabled={busy} onClick={() => run({ action: "starter" }, go)}>
                Add the {starterName} template
              </button>
            )}
            <button className="btn btn-secondary" disabled={busy} onClick={() => run({ action: "create", name: "New template" }, go)}>
              + New template
            </button>
          </div>
        )}
        {byProject.map((g) => (
          <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <span className="kicker">{g.name}</span>
            {g.templates.map(listItem)}
          </div>
        ))}
      </aside>

      {selected ? (
        <section className="panel" style={{ flex: "1 1 560px", minWidth: 0, padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
            <span className="tag tag-neutral">{selected.projectId ? projectName(selected.projectId) : "Library"}</span>
            {origin && (
              <span className="meta" style={{ fontSize: 12 }}>
                copied from{" "}
                <Link href={`${base}t=${origin.id}`}>{origin.name}</Link>
                {origin.projectId ? "" : " (library)"}
              </span>
            )}
            {editor && (
              <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                {!selected.projectId && directory.projects.length > 0 && (
                  <>
                    <select className="input" value={addTo} onChange={(e) => setAddTo(e.target.value)} style={{ width: "auto", fontSize: 12.5 }}>
                      <option value="">Add to project…</option>
                      {directory.clients.map((c) => (
                        <optgroup key={c.id} label={c.name}>
                          {directory.projects
                            .filter((p) => p.clientId === c.id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      className="btn btn-secondary"
                      disabled={busy || !addTo}
                      onClick={() => run({ action: "addToProject", templateId: selected.id, projectId: addTo }, (id) => (setAddTo(""), go(id)))}
                    >
                      Add
                    </button>
                  </>
                )}
                <button className="btn btn-ghost" disabled={busy} onClick={() => run({ action: "duplicate", templateId: selected.id }, go)}>
                  Duplicate
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busy || selected.notes > 0}
                  title={selected.notes ? `A ${uses} uses this template` : undefined}
                  onClick={() =>
                    confirming === "delete"
                      ? run({ action: "delete", templateId: selected.id }, () => router.push(memo ? `/templates?kind=${kind}` : "/templates"))
                      : setConfirming("delete")
                  }
                >
                  {confirming === "delete" ? "Delete?" : "Delete"}
                </button>
              </span>
            )}
          </div>

          <input
            key={`name-${selected.id}-${selected.name}`}
            className="input"
            style={{ fontSize: 20, fontWeight: 700 }}
            aria-label="Template name"
            {...saveOnBlur(selected.name, (v) => v && run({ action: "update", templateId: selected.id, name: v }))}
          />
          <textarea
            key={`scope-${selected.id}-${selected.scope ?? ""}`}
            className="input"
            rows={2}
            placeholder="What this template is for"
            aria-label="Template description"
            style={{ resize: "vertical", fontSize: 13 }}
            {...saveOnBlur(selected.scope ?? "", (v) => run({ action: "update", templateId: selected.id, scope: v }))}
          />
          {selected.projectId && selected.notes > 0 && (
            <p className="meta" style={{ margin: 0, fontSize: 12 }}>
              {selected.notes} {uses}
              {selected.notes === 1 ? " uses" : "s use"} this template. Section changes apply the next time it&apos;s
              generated; existing {kind === "deck" ? "slides" : memo ? "paragraphs" : "items"} stay where they are.
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Sections — in the order the {uses} shows them</span>
            <span className="meta" style={{ fontSize: 12 }}>
              {memo
                ? "“Fills from” limits what Claude may cite in a section: confirmed Themes, or codes of the chosen types. People can cite anything. A section with none selected takes anything."
                : "“Fills from” limits which codes Claude may cite in a section. People can cite any code anywhere. A section with none selected takes any code."}
            </span>
          </div>

          {selected.sections.map((s, i) => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: "var(--space-3)", alignItems: "start" }}>
              <span className="mono meta" style={{ paddingTop: 8 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  key={`sname-${s.id}-${s.name}`}
                  className="input"
                  style={{ fontWeight: 600 }}
                  aria-label="Section name"
                  {...saveOnBlur(s.name, (v) => v && run({ action: "updateSection", sectionId: s.id, name: v }))}
                />
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="meta" style={{ fontSize: 11.5, marginRight: 4 }}>
                    Fills from
                  </span>
                  {TYPES.map((t) => {
                    const on = s.requires.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className={`tag ${on ? "tag-accent" : "tag-outline"}`}
                        disabled={!editor || busy}
                        aria-pressed={on}
                        onClick={() =>
                          run({
                            action: "updateSection",
                            sectionId: s.id,
                            requires: on ? s.requires.filter((r) => r !== t) : [...s.requires, t],
                          })
                        }
                        style={{ cursor: editor ? "pointer" : "default", font: "inherit", fontSize: 11, opacity: on ? 1 : 0.7 }}
                      >
                        {SOURCE_LABEL[t] ?? t}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  key={`snote-${s.id}-${s.note ?? ""}`}
                  className="input"
                  rows={2}
                  placeholder="Guidance: what belongs here"
                  aria-label="Section guidance"
                  style={{ resize: "vertical", fontSize: 12.5 }}
                  {...saveOnBlur(s.note ?? "", (v) => run({ action: "updateSection", sectionId: s.id, note: v }))}
                />
              </div>
              {editor && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} disabled={busy || i === 0} onClick={() => run({ action: "moveSection", sectionId: s.id, delta: -1 })} aria-label="Move up">
                    ↑
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} disabled={busy || i === selected.sections.length - 1} onClick={() => run({ action: "moveSection", sectionId: s.id, delta: 1 })} aria-label="Move down">
                    ↓
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "2px 8px" }}
                    disabled={busy}
                    onClick={() => (confirming === s.id ? run({ action: "removeSection", sectionId: s.id }) : setConfirming(s.id))}
                  >
                    {confirming === s.id ? "Remove?" : "Remove"}
                  </button>
                </div>
              )}
            </div>
          ))}

          {editor && (
            <form
              style={{ display: "flex", gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (newSection.trim())
                  run({ action: "addSection", templateId: selected.id, name: newSection.trim(), requires: [] }, () => setNewSection(""));
              }}
            >
              <input className="input" placeholder="New section" value={newSection} onChange={(e) => setNewSection(e.target.value)} />
              <button className="btn btn-secondary" disabled={busy || !newSection.trim()}>
                Add section
              </button>
            </form>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </section>
      ) : (
        <div className="panel" style={{ flex: "1 1 560px", padding: "var(--space-6)" }}>
          <p className="meta" style={{ margin: 0 }}>
            No templates yet. {editor ? `Add the ${starterName} template to start, or create your own.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
