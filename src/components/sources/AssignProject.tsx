"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientLabel, type Directory } from "@/lib/directory";

/** Per-row project picker in the library, grouped by client. Assigning queues
 *  the transcript. Goes away when the library is organized by project. */
export function AssignProject({
  transcriptId,
  projectId,
  directory,
}: {
  transcriptId: string;
  projectId: string | null;
  directory: Pick<Directory, "clients" | "projects">;
}) {
  const router = useRouter();
  const [value, setValue] = useState(projectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function assign(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true);
    setError("");
    const res = await fetch(`/api/transcripts/${transcriptId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ record: { project_id: next || null } }),
    });
    setBusy(false);
    if (!res.ok) {
      setValue(prev);
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Couldn't assign.");
      return;
    }
    router.refresh();
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <select
        className="input"
        value={value}
        disabled={busy}
        onChange={(e) => assign(e.target.value)}
        style={{ fontSize: 12.5, padding: "4px 26px 4px 8px" }}
        aria-label="Project"
      >
        <option value="">Unassigned</option>
        {directory.clients.map((c) => (
          <optgroup key={c.id} label={clientLabel(c)}>
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
      {error && <span style={{ fontSize: 11, color: "var(--color-accent-800)" }}>{error}</span>}
    </span>
  );
}
