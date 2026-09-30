"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClientProjectPicker, SpeakersEditor, speakerValue, type SpeakerValue } from "@/components/pickers";
import { Dialog, Field, Notice } from "@/components/ui";
import { addOrg, toOrgRow, type Directory } from "@/lib/directory";
import type { SpeakerRole } from "@/lib/ingest/preview";

export type RecordValues = {
  id: string;
  title: string;
  recordedOn: string | null;
  projectId: string | null;
};

export type SpeakerRecord = {
  name: string;
  personId: string | null;
  role: SpeakerRole;
  organizationId: string | null;
  title: string | null;
  turns: number;
};


/** Edit everything about a transcript except what was said. */
export function EditRecordButton(props: {
  record: RecordValues;
  speakers: SpeakerRecord[];
  directory: Directory;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-secondary" style={{ fontSize: 11.5, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Edit record
      </button>
      {open && <EditRecordDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditRecordDialog({
  record,
  speakers: initialSpeakers,
  directory,
  onClose,
}: {
  record: RecordValues;
  speakers: SpeakerRecord[];
  directory: Directory;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(record.title);
  const [recordedOn, setRecordedOn] = useState(record.recordedOn ?? "");
  const [projectId, setProjectId] = useState(record.projectId ?? "");
  const [organizations, setOrganizations] = useState(directory.organizations);
  const [speakers, setSpeakers] = useState<Record<string, SpeakerValue>>(() =>
    Object.fromEntries(initialSpeakers.map((s) => [s.name, speakerValue({ ...s, newPerson: null }, directory.people, directory.organizations)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/transcripts/${record.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        record: {
          title,
          recorded_on: recordedOn || null,
          project_id: projectId || null,
        },
        speakers: Object.entries(speakers).map(([name, v]) => ({
          name,
          // A new person is created by name; clearing the field unlinks.
          ...(v.personId ? { person_id: v.personId } : v.newPerson ? { new_person: v.newPerson } : { person_id: null }),
          role: v.role,
          organization_id: v.organizationId || null,
          title: v.title || null,
        })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Couldn't save (${res.status}).`);
    router.refresh();
    onClose();
  }

  return (
    <Dialog title="Edit source record" onClose={busy ? undefined : onClose} width={880}>
      <p className="meta" style={{ margin: 0 }}>
        The lines stay exactly as recorded. Everything here can change, and each change is logged with your name.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "var(--space-3)" }}>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Recorded on">
          <input className="input" type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
        </Field>
        <ClientProjectPicker directory={directory} projectId={projectId} onChange={setProjectId} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="kicker">Who&apos;s speaking</span>
        <SpeakersEditor
          rows={initialSpeakers.map((s) => ({ name: s.name, detail: `${s.turns} turns` }))}
          values={speakers}
          onChange={(name, v) => setSpeakers((all) => ({ ...all, [name]: v }))}
          organizations={organizations}
          onOrgCreated={(org) => setOrganizations((all) => addOrg(all, toOrgRow(org)))}
          people={directory.people}
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !title.trim()}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Dialog>
  );
}
