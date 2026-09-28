"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IngestPreview, SourceKind } from "@/lib/ingest/preview";
import { withPaths, type Directory, type OrgOption } from "@/lib/directory";
import { ClientProjectPicker, SpeakersEditor, type SpeakerValue } from "@/components/pickers";
import { Dialog, Field, Notice } from "@/components/ui";

const SOURCE_LABEL: Record<SourceKind, string> = {
  meet: "Google Meet",
  wispr: "Wispr Flow",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  otter: "Otter.ai",
  granola: "Granola",
  upload: "Other upload",
};

const LAYOUT_LABEL: Record<IngestPreview["layout"], string> = {
  vtt: "WebVTT captions",
  srt: "SRT captions",
  "meet-gemini": "Google Meet with Gemini notes — transcript section only",
  "meet-transcript": "Google Meet transcript",
  plain: "Speaker-labelled text",
};

const toRow = (o: OrgOption) => ({ id: o.id, name: o.name, parent_id: o.parentId });

type Stage =
  | { kind: "pick" }
  | { kind: "review"; preview: IngestPreview }
  | { kind: "busy"; label: string; preview?: IngestPreview };

export function UploadDialog({
  directory,
  onClose,
}: {
  directory: Directory;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [pastedName, setPastedName] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [error, setError] = useState("");

  // Confirmed details, seeded from the preview.
  const [title, setTitle] = useState("");
  const [participant, setParticipant] = useState("");
  const [participantRole, setParticipantRole] = useState("");
  const [recordedOn, setRecordedOn] = useState("");
  const [source, setSource] = useState<SourceKind>("upload");
  const [projectId, setProjectId] = useState("");
  const [speakers, setSpeakers] = useState<Record<string, SpeakerValue>>({});
  const [organizations, setOrganizations] = useState<OrgOption[]>(directory.organizations);

  function sourceForm(): FormData {
    const form = new FormData();
    if (mode === "file" && file) form.append("file", file);
    if (mode === "paste") {
      form.append("pasted", pasted);
      form.append("pastedName", pastedName);
    }
    return form;
  }

  async function post(url: string, form: FormData) {
    const res = await fetch(url, { method: "POST", body: form });
    const body = await res.json().catch(() => ({ error: `Unexpected response (${res.status}).` }));
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
    return body;
  }

  async function read() {
    setError("");
    setStage({ kind: "busy", label: "Reading transcript…" });
    try {
      const preview: IngestPreview = await post("/api/ingest/preview", sourceForm());
      setTitle(mode === "paste" && pastedName.trim() ? pastedName.trim() : preview.title);
      setParticipant(preview.participant ?? "");
      setRecordedOn(preview.recordedOn ?? "");
      setSource(preview.source);
      setSpeakers(
        Object.fromEntries(
          preview.speakers.map((s) => [
            s.name,
            { displayName: s.displayName ?? "", role: s.role, organizationId: s.organizationId ?? "" },
          ]),
        ),
      );
      setStage({ kind: "review", preview });
    } catch (e) {
      setError((e as Error).message);
      setStage({ kind: "pick" });
    }
  }

  async function save(preview: IngestPreview) {
    setError("");
    setStage({ kind: "busy", label: "Saving…", preview });
    try {
      const form = sourceForm();
      form.append("sha256", preview.sha256);
      form.append("title", title);
      form.append("participant", participant);
      form.append("participantRole", participantRole);
      form.append("recordedOn", recordedOn);
      form.append("source", source);
      form.append("projectId", projectId);
      form.append(
        "speakers",
        JSON.stringify(Object.entries(speakers).map(([name, v]) => ({ name, ...v }))),
      );
      const { id } = await post("/api/ingest", form);
      router.push(`/transcripts/${id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setStage({ kind: "review", preview });
    }
  }

  const busy = stage.kind === "busy";
  const preview = stage.kind === "pick" ? undefined : stage.preview;
  const canRead = mode === "file" ? !!file : !!pasted.trim();
  const noParticipant = preview && !Object.values(speakers).some((v) => v.role === "participant");

  return (
    <Dialog title="Add a transcript" onClose={busy ? undefined : onClose} width={880}>
      {!preview ? (
        <>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {(["file", "paste"] as const).map((m) => (
              <label key={m} className="seg-opt">
                <input
                  type="radio"
                  name="upload-mode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                <span>{m === "file" ? "Upload a file" : "Paste a transcript"}</span>
              </label>
            ))}
          </div>

          {mode === "file" ? (
            <Field label="Transcript file" hint="Google Meet .docx, Teams or Zoom .vtt, .srt, or .txt. Up to 8 MB.">
              <input
                className="input"
                type="file"
                accept=".vtt,.srt,.docx,.txt,.md"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          ) : (
            <>
              <Field label="Meeting name" hint="Becomes the stored file's name.">
                <input
                  className="input"
                  value={pastedName}
                  onChange={(e) => setPastedName(e.target.value)}
                  placeholder="Profisee and Delaware Early Education"
                />
              </Field>
              <Field
                label="Transcript"
                hint="Paste the transcript itself, one “Name: what they said” per line — not the meeting summary."
              >
                <textarea
                  className="input mono"
                  rows={12}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  style={{ resize: "vertical", fontSize: 12 }}
                />
              </Field>
            </>
          )}

          {error && <Notice tone="error">{error}</Notice>}

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={read} disabled={!canRead || busy}>
              {busy ? stage.label : "Read transcript"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="meta" style={{ margin: 0 }}>
            <strong>{preview.fileName}</strong> · {LAYOUT_LABEL[preview.layout]} ·{" "}
            {preview.lineCount} turns
            {preview.durationMins ? ` · ${preview.durationMins} min` : ""}
          </p>

          {preview.duplicateOf && (
            <Notice tone="error">
              This exact file is already in the library as{" "}
              <a href={`/transcripts/${preview.duplicateOf.id}`}>{preview.duplicateOf.title}</a>.
            </Notice>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "var(--space-3)" }}>
            <Field label="Title">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Participant">
              <input className="input" value={participant} onChange={(e) => setParticipant(e.target.value)} />
            </Field>
            <Field label="Participant's role" hint="Their job, e.g. Director, OCCL.">
              <input className="input" value={participantRole} onChange={(e) => setParticipantRole(e.target.value)} />
            </Field>
            <Field label="Recorded on">
              <input className="input" type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
            </Field>
            <Field label="Source">
              <select className="input" value={source} onChange={(e) => setSource(e.target.value as SourceKind)}>
                {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <ClientProjectPicker
              directory={directory}
              projectId={projectId}
              onChange={setProjectId}
              noneLabel="Library only, for now"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span className="kicker">Who&apos;s speaking</span>
            <SpeakersEditor
              rows={preview.speakers.map((sp) => ({
                name: sp.name,
                detail: (
                  <>
                    {sp.turns} turns · “{sp.firstWords}
                    {sp.firstWords.length >= 90 ? "…" : ""}”
                  </>
                ),
              }))}
              values={speakers}
              onChange={(name, v) => setSpeakers((all) => ({ ...all, [name]: v }))}
              organizations={organizations}
              onOrgCreated={(org) => setOrganizations((all) => withPaths([...all.map(toRow), toRow(org)]))}
            />
            {noParticipant && (
              <p className="meta" style={{ margin: 0 }}>
                No one is marked as the participant. Coding looks for findings in the participant&apos;s turns.
              </p>
            )}
          </div>

          {error && <Notice tone="error">{error}</Notice>}

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setStage({ kind: "pick" })} disabled={busy}>
              Back
            </button>
            <button
              className="btn btn-primary"
              onClick={() => save(preview)}
              disabled={busy || !title.trim() || !!preview.duplicateOf}
            >
              {busy ? stage.label : "Save transcript"}
            </button>
          </div>
          <p className="meta" style={{ margin: 0 }}>
            Saving stores the original file and its checksum. The lines can&apos;t be edited afterwards; everything
            above can, from the transcript page.
          </p>
        </>
      )}
    </Dialog>
  );
}
