"use client";

import { useEffect, useRef, useState } from "react";
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

type Details = {
  title: string;
  participant: string;
  participantRole: string;
  recordedOn: string;
  source: SourceKind;
};

/** One transcript on its way in: a file or a paste, its preview, and what the
 *  uploader has confirmed about it. */
type Item = {
  key: string;
  file: File | null;
  /** Where the file came from, when a connector fetched it. */
  external: External | null;
  pasted: { text: string; name: string; source: SourceKind } | null;
  state: "reading" | "ready" | "unreadable" | "saving" | "saved" | "failed";
  error: string;
  preview: IngestPreview | null;
  /** Another item in this batch with the same checksum. */
  sameAs: string | null;
  details: Details;
  speakers: Record<string, SpeakerValue>;
  /** Undefined follows the batch's project. */
  projectId: string | undefined;
  savedId: string | null;
  open: boolean;
};

/** A file a connector fetched: its outside id, and what its name told us. */
export type External = { provider: "google"; id: string; title: string; recordedOn: string | null };
export type Incoming = { file: File; external: External };

const label = (i: Item) => i.file?.name ?? (i.pasted?.name || "Pasted transcript");
const skipped = (i: Item) => i.state === "unreadable" || !!i.preview?.duplicateOf || !!i.sameAs;

async function post(url: string, form: FormData) {
  const res = await fetch(url, { method: "POST", body: form });
  const body = await res.json().catch(() => ({ error: `Unexpected response (${res.status}).` }));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

function sourceForm(i: Item): FormData {
  const form = new FormData();
  if (i.file) form.append("file", i.file);
  if (i.pasted) {
    form.append("pasted", i.pasted.text);
    form.append("pastedName", i.pasted.name);
  }
  return form;
}

/** Run tasks a few at a time, so twenty files don't fire twenty requests. */
async function inBatches<T>(items: T[], size: number, run: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

export function UploadDialog({
  directory,
  defaultProjectId = "",
  incoming,
  onClose,
}: {
  directory: Directory;
  defaultProjectId?: string;
  /** Files a connector already fetched: read them straight away. */
  incoming?: Incoming[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"pick" | "review" | "done">("pick");
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [pastedName, setPastedName] = useState("");
  // Pasted text is most often Wispr Flow's, but not always.
  const [pastedSource, setPastedSource] = useState<SourceKind>("wispr");
  const [items, setItems] = useState<Item[]>([]);
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [organizations, setOrganizations] = useState<OrgOption[]>(directory.organizations);
  const [busy, setBusy] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ id: string; title: string } | null>(null);

  const update = (key: string, patch: Partial<Item> | ((i: Item) => Partial<Item>)) =>
    setItems((all) =>
      all.map((i) => (i.key === key ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i)),
    );

  async function read(from?: Incoming[]) {
    setLastSaved(null);
    const picked: (Incoming | { file: File | null; external: null })[] =
      from ?? (mode === "file" ? files : [null]).map((file) => ({ file, external: null }));
    const fresh: Item[] = picked.map(({ file, external }, n) => ({
      key: `${Date.now()}-${n}`,
      file,
      external,
      pasted: file ? null : { text: pasted, name: pastedName.trim(), source: pastedSource },
      state: "reading",
      error: "",
      preview: null,
      sameAs: null,
      details: { title: "", participant: "", participantRole: "", recordedOn: "", source: "upload" },
      speakers: {},
      projectId: undefined,
      savedId: null,
      open: from ? from.length === 1 : opensExpanded(mode, files),
    }));
    setItems(fresh);
    setStage("review");
    setBusy(true);

    const seen = new Map<string, string>(); // sha256 → first item's label, for in-batch duplicates
    await inBatches(fresh, 3, async (item) => {
      try {
        const preview: IngestPreview = await post("/api/ingest/preview", sourceForm(item));
        const first = seen.get(preview.sha256);
        if (!first) seen.set(preview.sha256, label(item));
        update(item.key, {
          state: "ready",
          preview,
          sameAs: first ?? null,
          details: {
            // A connector's name for the meeting beats one guessed from the file name.
            title: item.external?.title || item.pasted?.name || preview.title,
            participant: preview.participant ?? "",
            participantRole: "",
            recordedOn: preview.recordedOn ?? item.external?.recordedOn ?? "",
            source: item.external ? "meet" : (item.pasted?.source ?? preview.source),
          },
          speakers: Object.fromEntries(
            preview.speakers.map((s) => [
              s.name,
              { displayName: s.displayName ?? "", role: s.role, organizationId: s.organizationId ?? "" },
            ]),
          ),
        });
      } catch (e) {
        update(item.key, { state: "unreadable", error: (e as Error).message });
      }
    });
    setBusy(false);
  }

  async function saveOne(item: Item): Promise<string | null> {
    update(item.key, { state: "saving", error: "" });
    try {
      const form = sourceForm(item);
      form.append("sha256", item.preview!.sha256);
      form.append("title", item.details.title);
      form.append("participant", item.details.participant);
      form.append("participantRole", item.details.participantRole);
      form.append("recordedOn", item.details.recordedOn);
      form.append("source", item.details.source);
      form.append("projectId", item.projectId ?? projectId);
      form.append("speakers", JSON.stringify(Object.entries(item.speakers).map(([name, v]) => ({ name, ...v }))));
      const { id } = await post("/api/ingest", form);
      update(item.key, { state: "saved", savedId: id });
      if (item.external) {
        // Best effort: the transcript is in either way; this only marks the
        // Drive file as imported.
        await fetch("/api/connectors/google/meet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId: item.external.id, transcriptId: id }),
        }).catch(() => {});
      }
      return id;
    } catch (e) {
      update(item.key, { state: "failed", error: (e as Error).message, open: true });
      return null;
    }
  }

  /** Save every item that can be saved, one at a time; a failure doesn't stop
   *  the rest. Then open the transcript, start the next one, or summarize. */
  async function save(then: "open" | "another" | "summary") {
    setBusy(true);
    const toSave = items.filter((i) => !skipped(i) && (i.state === "ready" || i.state === "failed"));
    let lastId: string | null = null;
    let failures = 0;
    for (const item of toSave) {
      const id = await saveOne(item);
      if (id) lastId = id;
      else failures++;
    }
    setBusy(false);
    router.refresh();

    if (failures) return; // stay on the review; failed rows are open with their errors
    if (then === "open" && lastId) {
      router.push(`/transcripts/${lastId}`);
      onClose();
    } else if (then === "another") {
      setLastSaved(lastId ? { id: lastId, title: toSave[0].details.title } : null);
      setFiles([]);
      setPasted("");
      setPastedName("");
      setItems([]);
      setStage("pick");
    } else {
      setStage("done");
    }
  }

  // Files a connector fetched are read as soon as the dialog opens.
  const started = useRef(false);
  useEffect(() => {
    if (!incoming?.length || started.current) return;
    started.current = true;
    void read(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const reading = items.some((i) => i.state === "reading");
  const saveable = items.filter((i) => !skipped(i) && i.state !== "saved");
  const missingTitle = saveable.some((i) => !i.details.title.trim());
  const single = items.length === 1;
  const canRead = mode === "file" ? files.length > 0 : !!pasted.trim();
  const cantSave = busy || reading || !saveable.length || missingTitle;

  return (
    <Dialog title="Add transcripts" onClose={busy ? undefined : onClose} width={920}>
      {stage === "pick" && (
        <>
          {lastSaved && (
            <Notice>
              Saved <a href={`/transcripts/${lastSaved.id}`}>{lastSaved.title}</a>. Add the next one — the client and
              project are kept.
            </Notice>
          )}
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
                <span>{m === "file" ? "Upload files" : "Paste a transcript"}</span>
              </label>
            ))}
          </div>

          {mode === "file" ? (
            <Field
              label="Transcript files"
              hint="Choose one or several: Google Meet .docx, Teams or Zoom .vtt, .srt, or .txt. Up to 8 MB each."
            >
              <input
                // Remount after each save, so the picker actually clears.
                key={lastSaved?.id ?? "files"}
                className="input"
                type="file"
                multiple
                accept=".vtt,.srt,.docx,.txt,.md"
                onChange={(e) => setFiles([...(e.target.files ?? [])])}
              />
            </Field>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "var(--space-3)" }}>
                <Field label="Meeting name" hint="Becomes the title and the stored file's name.">
                  <input
                    className="input"
                    value={pastedName}
                    onChange={(e) => setPastedName(e.target.value)}
                    placeholder="Profisee and Delaware Early Education"
                  />
                </Field>
                <Field label="Copied from">
                  <select
                    className="input"
                    value={pastedSource}
                    onChange={(e) => setPastedSource(e.target.value as SourceKind)}
                  >
                    {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
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

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose}>
              {lastSaved ? "Done" : "Cancel"}
            </button>
            <button className="btn btn-primary" onClick={() => read()} disabled={!canRead}>
              {mode === "file" && files.length > 1 ? `Read ${files.length} transcripts` : "Read transcript"}
            </button>
          </div>
        </>
      )}

      {stage === "review" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "var(--space-3)" }}>
            <ClientProjectPicker
              directory={directory}
              projectId={projectId}
              onChange={setProjectId}
              noneLabel="Library only, for now"
            />
          </div>
          {!single && (
            <p className="meta" style={{ margin: 0 }}>
              The client and project apply to every transcript below unless one is changed individually. Open a row to
              check its details and speakers.
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {items.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                single={single}
                directory={directory}
                batchProjectId={projectId}
                organizations={organizations}
                onOrgCreated={(org) => setOrganizations((all) => withPaths([...all.map(toRow), toRow(org)]))}
                onChange={(patch) => update(item.key, patch)}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => setStage("pick")} disabled={busy}>
              Back
            </button>
            {single ? (
              <>
                <button className="btn btn-secondary" onClick={() => save("another")} disabled={cantSave}>
                  Save and add another
                </button>
                <button className="btn btn-primary" onClick={() => save("open")} disabled={cantSave}>
                  {busy ? "Saving…" : "Save transcript"}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => save("summary")} disabled={cantSave}>
                {reading
                  ? "Reading…"
                  : busy
                    ? "Saving…"
                    : `Save ${saveable.length} transcript${saveable.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
          <p className="meta" style={{ margin: 0 }}>
            Saving stores each original file and its checksum. Lines can&apos;t be edited afterwards; everything else
            can, from the transcript page.
          </p>
        </>
      )}

      {stage === "done" && (
        <>
          <Summary items={items} />
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setFiles([]);
                setItems([]);
                setLastSaved(null);
                setStage("pick");
              }}
            >
              Add more
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** A lone transcript opens straight into its full review. */
function opensExpanded(mode: "file" | "paste", files: File[]) {
  return mode === "paste" || files.length === 1;
}

function StatusTag({ item }: { item: Item }) {
  const hasParticipant = Object.values(item.speakers).some((s) => s.role === "participant");
  const [cls, text] =
    item.state === "reading"
      ? ["tag-neutral", "Reading…"]
      : item.state === "unreadable"
        ? ["tag-outline", "Can't read"]
        : item.preview?.duplicateOf
          ? ["tag-outline", "Already in library"]
          : item.sameAs
            ? ["tag-outline", "Duplicate in batch"]
            : item.state === "saving"
              ? ["tag-neutral", "Saving…"]
              : item.state === "saved"
                ? ["tag-accent", "Saved"]
                : item.state === "failed"
                  ? ["tag-outline", "Failed"]
                  : !hasParticipant
                    ? ["tag-outline", "No participant"]
                    : ["tag-neutral", "Ready"];
  return <span className={`tag ${cls}`}>{text}</span>;
}

function ItemRow({
  item,
  single,
  directory,
  batchProjectId,
  organizations,
  onOrgCreated,
  onChange,
}: {
  item: Item;
  single: boolean;
  directory: Directory;
  batchProjectId: string;
  organizations: OrgOption[];
  onOrgCreated: (org: OrgOption) => void;
  onChange: (patch: Partial<Item> | ((i: Item) => Partial<Item>)) => void;
}) {
  const p = item.preview;
  const d = item.details;
  const setDetail = (patch: Partial<Details>) => onChange((i) => ({ details: { ...i.details, ...patch } }));
  const locked = item.state === "saving" || item.state === "saved";

  return (
    <div
      className="panel"
      style={{ padding: "var(--space-3) var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        {!single && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "2px 8px" }}
            onClick={() => onChange((i) => ({ open: !i.open }))}
            disabled={!p || skipped(item)}
            aria-expanded={item.open}
            aria-label={item.open ? "Collapse" : "Expand"}
          >
            {item.open ? "▾" : "▸"}
          </button>
        )}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.title || label(item)}
          </strong>
          <span className="meta" style={{ fontSize: 11.5 }}>
            {label(item)}
            {p && ` · ${LAYOUT_LABEL[p.layout]} · ${p.lineCount} turns${p.durationMins ? ` · ${p.durationMins} min` : ""}`}
            {p && !single && d.participant && ` · ${d.participant}`}
          </span>
        </div>
        <StatusTag item={item} />
        {item.savedId && (
          <a href={`/transcripts/${item.savedId}`} className="meta" style={{ fontSize: 12 }}>
            Open
          </a>
        )}
      </div>

      {item.error && <Notice tone="error">{item.error}</Notice>}
      {p?.duplicateOf && (
        <Notice>
          This exact file is already in the library as{" "}
          <a href={`/transcripts/${p.duplicateOf.id}`}>{p.duplicateOf.title}</a>. It will be skipped.
        </Notice>
      )}
      {item.sameAs && <Notice>Same file as “{item.sameAs}” above. It will be skipped.</Notice>}

      {p && item.open && !skipped(item) && (
        <fieldset
          disabled={locked}
          style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "var(--space-3)" }}>
            <Field label="Title">
              <input className="input" value={d.title} onChange={(e) => setDetail({ title: e.target.value })} />
            </Field>
            <Field label="Participant">
              <input className="input" value={d.participant} onChange={(e) => setDetail({ participant: e.target.value })} />
            </Field>
            <Field label="Participant's role" hint="Their job, e.g. Director, OCCL.">
              <input
                className="input"
                value={d.participantRole}
                onChange={(e) => setDetail({ participantRole: e.target.value })}
              />
            </Field>
            <Field label="Recorded on">
              <input
                className="input"
                type="date"
                value={d.recordedOn}
                onChange={(e) => setDetail({ recordedOn: e.target.value })}
              />
            </Field>
            <Field label="Source">
              <select
                className="input"
                value={d.source}
                onChange={(e) => setDetail({ source: e.target.value as SourceKind })}
              >
                {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {!single && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={item.projectId !== undefined}
                onChange={(e) => onChange({ projectId: e.target.checked ? batchProjectId : undefined })}
              />
              A different client or project for this one
            </label>
          )}
          {!single && item.projectId !== undefined && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "var(--space-3)" }}>
              <ClientProjectPicker
                directory={directory}
                projectId={item.projectId}
                onChange={(id) => onChange({ projectId: id })}
                noneLabel="Library only, for now"
              />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span className="kicker">Who&apos;s speaking</span>
            <SpeakersEditor
              rows={p.speakers.map((sp) => ({
                name: sp.name,
                detail: (
                  <>
                    {sp.turns} turns · “{sp.firstWords}
                    {sp.firstWords.length >= 90 ? "…" : ""}”
                  </>
                ),
              }))}
              values={item.speakers}
              onChange={(name, v) => onChange((i) => ({ speakers: { ...i.speakers, [name]: v } }))}
              organizations={organizations}
              onOrgCreated={onOrgCreated}
            />
            {!Object.values(item.speakers).some((s) => s.role === "participant") && (
              <p className="meta" style={{ margin: 0 }}>
                No one is marked as the participant. Coding looks for findings in the participant&apos;s turns.
              </p>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function Summary({ items }: { items: Item[] }) {
  const saved = items.filter((i) => i.state === "saved");
  const skippedItems = items.filter(skipped);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <p style={{ margin: 0, fontSize: 14 }}>
        Saved {saved.length} transcript{saved.length === 1 ? "" : "s"}
        {skippedItems.length ? `; skipped ${skippedItems.length}` : ""}.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        {saved.map((i) => (
          <li key={i.key}>
            <a href={`/transcripts/${i.savedId}`}>{i.details.title}</a>
          </li>
        ))}
        {skippedItems.map((i) => (
          <li key={i.key} className="meta">
            {label(i)} —{" "}
            {i.state === "unreadable"
              ? i.error
              : i.preview?.duplicateOf
                ? "already in the library"
                : "duplicate in this batch"}
          </li>
        ))}
      </ul>
    </div>
  );
}
