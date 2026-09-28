"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Field, Notice } from "@/components/ui";
import type { ClientOption, Directory } from "@/lib/directory";
import { UploadDialog } from "./UploadDialog";

/** The Sources page's editor actions: add a transcript, start a project. */
export function SourcesActions({ directory }: { directory: Directory }) {
  const [open, setOpen] = useState<"upload" | "project" | null>(null);

  return (
    <div style={{ display: "flex", gap: "var(--space-2)" }}>
      <button className="btn btn-secondary" onClick={() => setOpen("project")}>
        New project
      </button>
      <button className="btn btn-primary" onClick={() => setOpen("upload")}>
        Add transcript
      </button>
      {open === "upload" && <UploadDialog directory={directory} onClose={() => setOpen(null)} />}
      {open === "project" && <NewProjectDialog clients={directory.clients} onClose={() => setOpen(null)} />}
    </div>
  );
}

function NewProjectDialog({ clients, onClose }: { clients: ClientOption[]; onClose: () => void }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [clientName, setClientName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isNewClient = clientId === "";

  async function create() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isNewClient ? { clientName, projectName } : { clientId, projectName }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Request failed (${res.status}).`);
    router.refresh();
    onClose();
  }

  return (
    <Dialog title="New project" onClose={busy ? undefined : onClose}>
      <Field label="Client">
        <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="">New client…</option>
        </select>
      </Field>
      {isNewClient && (
        <Field label="Client name">
          <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
        </Field>
      )}
      <Field label="Project name">
        <input className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={create}
          disabled={busy || !projectName.trim() || (isNewClient && !clientName.trim())}
        >
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </Dialog>
  );
}
