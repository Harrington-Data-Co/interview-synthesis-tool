"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Field, Notice } from "@/components/ui";
import { clientLabel, type ClientOption, type Directory } from "@/lib/directory";
import { UploadDialog } from "./UploadDialog";

/** Editor actions: add transcripts (into a given project, when on one) and,
 *  from the library or a client's page, start a project (for that client,
 *  when on one). */
export function SourcesActions({
  directory,
  projectId,
  clientId,
  newProject = true,
}: {
  directory: Directory;
  projectId?: string;
  clientId?: string;
  newProject?: boolean;
}) {
  const [open, setOpen] = useState<"upload" | "project" | null>(null);

  return (
    <div style={{ display: "flex", gap: "var(--space-2)" }}>
      {newProject && (
        <button className="btn btn-secondary" onClick={() => setOpen("project")}>
          New project
        </button>
      )}
      <button className="btn btn-primary" onClick={() => setOpen("upload")}>
        Add transcripts
      </button>
      {open === "upload" && (
        <UploadDialog directory={directory} defaultProjectId={projectId} onClose={() => setOpen(null)} />
      )}
      {open === "project" && <NewProjectDialog clients={directory.clients} defaultClientId={clientId} onClose={() => setOpen(null)} />}
    </div>
  );
}

function NewProjectDialog({ clients, defaultClientId, onClose }: { clients: ClientOption[]; defaultClientId?: string; onClose: () => void }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? "");
  const [clientName, setClientName] = useState("");
  const [clientCode, setClientCode] = useState("");
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
      body: JSON.stringify(isNewClient ? { clientName, clientCode, projectName } : { clientId, projectName }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Request failed (${res.status}).`);
    router.push(body.path);
    router.refresh();
    onClose();
  }

  return (
    <Dialog title="New project" onClose={busy ? undefined : onClose}>
      <Field label="Client" hint="The paying customer the project is for.">
        <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {clientLabel(c)}
            </option>
          ))}
          <option value="">New client…</option>
        </select>
      </Field>
      {isNewClient && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "var(--space-3)" }}>
          <Field label="Client name">
            <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
          </Field>
          <Field label="Code" hint="Optional, as in Google Drive.">
            <input className="input" value={clientCode} placeholder="e.g. LWF" onChange={(e) => setClientCode(e.target.value)} />
          </Field>
        </div>
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
