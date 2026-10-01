"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UploadDialog, type Incoming } from "@/components/sources/UploadDialog";
import { docxName } from "@/lib/connectors/names";
import { Dialog, Notice } from "@/components/ui";
import type { Directory } from "@/lib/directory";

export type Row = {
  id: string;
  name: string;
  title: string;
  recordedOn: string | null;
  time: string | null;
  createdTime: string;
  sharedDrive: boolean;
  link: string | null;
  transcriptId: string | null;
  /** A transcript uploaded by hand earlier from this same Doc, probably. */
  uploadedId: string | null;
  /** Someone set it aside as not an interview. */
  dismissed: boolean;
};

/** Download picked Meet transcripts from Drive as .docx files, ready for the
 *  upload review. Stops at the first failure and says which file. */
export async function fetchIncoming(rows: Row[], onProgress: (done: number) => void): Promise<{ files: Incoming[] } | { error: string }> {
  const files: Incoming[] = [];
  for (const r of rows) {
    const res = await fetch(`/api/connectors/google/meet/file?id=${encodeURIComponent(r.id)}`);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return { error: `${r.title}: ${b.error ?? `download failed (${res.status})`}` };
    }
    const blob = await res.blob();
    files.push({
      file: new File([blob], docxName(r.name), { type: blob.type }),
      external: { provider: "google", id: r.id, title: r.title, recordedOn: r.recordedOn },
    });
    onProgress(files.length);
  }
  return { files };
}

/** Set a Drive file aside as not an interview, or bring it back. */
export async function setAside(fileId: string, dismissed: boolean): Promise<string | null> {
  const res = await fetch("/api/connectors/google/meet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId, dismissed }) });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return b.error ?? `Couldn't update it (${res.status}).`;
}

type Listed = { files: Row[]; next: string | null } | { error: string };

/** One page of Meet transcripts from the connected Drive. */
async function list(search: string, page?: string): Promise<Listed> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (page) params.set("page", page);
  const res = await fetch(`/api/connectors/google/meet?${params}`);
  const b = await res.json().catch(() => ({}));
  return res.ok ? { files: b.files, next: b.next } : { error: b.error ?? `Couldn't list Meet transcripts (${res.status}).` };
}

const muted = (pct: number) => `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** Pick Meet transcripts from Google Drive (every drive the account can see,
 *  not just "Meet Recordings") and bring them in through the usual upload
 *  review: speakers, organizations, project. Imported ones are marked. */
export function MeetImport({ directory, onClose }: { directory: Directory; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState<{ done: number; of: number } | null>(null);
  const [incoming, setIncoming] = useState<Incoming[] | null>(null);

  const apply = (r: Listed, page?: string) => {
    setLoading(false);
    if ("error" in r) return setError(r.error);
    setError("");
    setRows((cur) => (page ? [...cur, ...r.files] : r.files));
    setNext(r.next);
  };
  const load = async (search: string, page?: string) => apply(await list(search, page), page);

  useEffect(() => {
    let live = true;
    list("").then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, []);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setPicked(new Set());
    load(q);
  }

  async function importPicked() {
    const chosen = rows.filter((r) => picked.has(r.id));
    setFetching({ done: 0, of: chosen.length });
    setError("");
    const got = await fetchIncoming(chosen, (done) => setFetching({ done, of: chosen.length }));
    if ("error" in got) {
      setFetching(null);
      return setError(got.error);
    }
    setIncoming(got.files);
  }

  // Once the files are in hand, the upload review takes over.
  if (incoming) return <UploadDialog directory={directory} incoming={incoming} onClose={onClose} />;

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog title="Import from Google Meet" onClose={fetching ? undefined : onClose} width={820}>
      <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
        Meet transcripts from every drive your Google account can see, including shared drives, newest first. Pick the
        interviews to bring in; each goes through the usual review before it&apos;s saved.
      </p>
      <form onSubmit={search} style={{ display: "flex", gap: "var(--space-2)" }}>
        <input className="input" placeholder="Search names and text, e.g. a client or a person" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-secondary" type="submit" disabled={loading}>
          Search
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="panel" style={{ maxHeight: 420, overflow: "auto", padding: "4px 0" }}>
        {loading && !rows.length && <span className="meta" style={{ display: "block", padding: "10px 14px" }}>Looking in Google Drive…</span>}
        {!loading && !rows.length && !error && (
          <span className="meta" style={{ display: "block", padding: "10px 14px" }}>
            {q.trim() ? "No Meet transcripts match that search." : "No Meet transcripts found in this Google account's drives."}
          </span>
        )}
        {rows.map((r) => (
          <label
            key={r.id}
            style={{
              display: "grid",
              gridTemplateColumns: "18px 1fr auto",
              gap: 10,
              padding: "8px 14px",
              alignItems: "start",
              cursor: r.transcriptId ? "default" : "pointer",
              borderBottom: `1px solid ${muted(6)}`,
              opacity: r.transcriptId ? 0.65 : 1,
            }}
          >
            <input type="checkbox" checked={picked.has(r.id)} disabled={!!r.transcriptId || !!fetching} onChange={() => toggle(r.id)} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>
              <span className="meta" style={{ fontSize: 11.5 }}>
                {r.recordedOn ? `${r.recordedOn}${r.time ? ` · ${r.time}` : ""}` : `Added ${r.createdTime.slice(0, 10)}`} · {r.sharedDrive ? "Shared drive" : "My Drive"}
              </span>
            </span>
            <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
              {r.transcriptId ? (
                <Link href={`/transcripts/${r.transcriptId}`} onClick={onClose}>
                  Imported · open
                </Link>
              ) : r.dismissed ? (
                <button
                  type="button"
                  className="meta"
                  title="Set aside as not an interview"
                  onClick={async (e) => {
                    e.preventDefault();
                    const err = await setAside(r.id, false);
                    if (err) return setError(err);
                    setRows((all) => all.map((x) => (x.id === r.id ? { ...x, dismissed: false } : x)));
                  }}
                  style={{ border: 0, background: "none", cursor: "pointer", fontSize: 12 }}
                >
                  Set aside · bring back
                </button>
              ) : r.uploadedId ? (
                <Link href={`/transcripts/${r.uploadedId}`} onClick={onClose} title="A transcript uploaded earlier has this Doc's file name">
                  Uploaded before · open
                </Link>
              ) : null}
              {r.link && (
                <a href={r.link} target="_blank" rel="noreferrer" className="meta" onClick={(e) => e.stopPropagation()}>
                  Drive ↗
                </a>
              )}
            </span>
          </label>
        ))}
        {next && (
          <button className="btn btn-ghost" style={{ margin: "6px 14px" }} disabled={loading} onClick={() => { setLoading(true); load(q, next); }}>
            Show more
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", alignItems: "center" }}>
        {fetching && (
          <span className="meta" style={{ fontSize: 12, marginRight: "auto" }}>
            Downloading from Google Drive… {fetching.done} of {fetching.of}
          </span>
        )}
        <button className="btn btn-ghost" onClick={onClose} disabled={!!fetching}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={importPicked} disabled={!picked.size || !!fetching}>
          {picked.size ? `Import ${picked.size}` : "Import"}
        </button>
      </div>
    </Dialog>
  );
}
