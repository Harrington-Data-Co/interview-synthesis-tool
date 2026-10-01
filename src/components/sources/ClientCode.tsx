"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** A client's short code beside its name in the library: shown as a tag,
 *  and for editors, set or changed in place (Enter saves, Escape cancels). */
export function ClientCode({ clientId, code, editor }: { clientId: string; code: string | null; editor: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (draft.trim() === (code ?? "")) return setEditing(false);
    setBusy(true);
    setError("");
    const res = await fetch(`/api/clients/${clientId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: draft }) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(b.error ?? "Couldn't save the code.");
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input
          className="input"
          autoFocus
          value={draft}
          placeholder="e.g. LWF"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(code ?? "");
              setEditing(false);
            }
          }}
          style={{ fontSize: 12, width: 110, padding: "2px 8px" }}
          aria-label="Client code"
        />
        {error && <span style={{ fontSize: 11, color: "var(--color-accent-800)" }}>{error}</span>}
      </span>
    );
  }
  if (code) {
    return (
      <button
        type="button"
        className="tag tag-outline mono"
        disabled={!editor}
        onClick={() => setEditing(true)}
        title={editor ? "Your code for this client; click to change" : "Your code for this client"}
        style={{ font: "inherit", fontSize: 10.5, cursor: editor ? "pointer" : "default" }}
      >
        {code}
      </button>
    );
  }
  return editor ? (
    <button type="button" className="meta" onClick={() => setEditing(true)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 11.5 }}>
      + code
    </button>
  ) : null;
}
