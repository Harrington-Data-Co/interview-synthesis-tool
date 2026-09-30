"use client";

import { useCallback, useEffect, useState } from "react";
import { UploadDialog, type Incoming } from "@/components/sources/UploadDialog";
import type { Directory } from "@/lib/directory";
import { fetchIncoming, setAside, type Row } from "./MeetImport";

type Waiting = { state: "loading" } | { state: "error"; text: string } | { state: "ready"; rows: Row[] };

async function loadWaiting(): Promise<Waiting> {
  const res = await fetch("/api/connectors/google/meet?waiting=1");
  const b = await res.json().catch(() => ({}));
  return res.ok ? { state: "ready", rows: b.files as Row[] } : { state: "error", text: b.error ?? `Couldn't check Google Drive (${res.status}).` };
}

/** New Meet transcripts in Google Drive, shown on Sources without asking:
 *  the newest ones not yet in the library (imported or uploaded by hand)
 *  and not set aside. Tick and review them into the library through the
 *  usual upload review, or set one aside as not an interview. */
export function DriveInbox({ directory }: { directory: Directory }) {
  const [waiting, setWaiting] = useState<Waiting>({ state: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState<{ done: number; of: number } | null>(null);
  const [incoming, setIncoming] = useState<Incoming[] | null>(null);
  const [error, setError] = useState("");

  const apply = useCallback((w: Waiting) => {
    setWaiting(w);
    // Everything new starts ticked; untick or set aside what isn't an interview.
    if (w.state === "ready") setPicked(new Set(w.rows.map((r) => r.id)));
  }, []);
  useEffect(() => {
    let live = true;
    loadWaiting().then((w) => live && apply(w));
    return () => {
      live = false;
    };
  }, [apply]);

  async function review() {
    if (waiting.state !== "ready") return;
    const chosen = waiting.rows.filter((r) => picked.has(r.id));
    setError("");
    setFetching({ done: 0, of: chosen.length });
    const got = await fetchIncoming(chosen, (done) => setFetching({ done, of: chosen.length }));
    setFetching(null);
    if ("error" in got) return setError(got.error);
    setIncoming(got.files);
  }

  async function dismiss(r: Row) {
    const err = await setAside(r.id, true);
    if (err) return setError(err);
    setWaiting((w) => (w.state === "ready" ? { ...w, rows: w.rows.filter((x) => x.id !== r.id) } : w));
    setPicked((p) => {
      const n = new Set(p);
      n.delete(r.id);
      return n;
    });
  }

  if (waiting.state === "loading") return <span className="meta" style={{ fontSize: 12.5 }}>Checking Google Drive for new transcripts…</span>;
  if (waiting.state === "error") return <span style={{ fontSize: 12.5, color: "var(--color-danger, #b3261e)" }}>{waiting.text}</span>;
  if (!waiting.rows.length) return <span className="meta" style={{ fontSize: 12.5 }}>Nothing new in Google Drive: every recent Meet transcript is in the library or set aside.</span>;

  const rows = waiting.rows;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", borderTop: "1px solid var(--line-2)", paddingTop: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5 }}>
          {rows.length} new in Google Drive
        </strong>
        <span className="meta" style={{ fontSize: 12 }}>
          Recent Meet transcripts not in the library yet.
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          {fetching && (
            <span className="meta" style={{ fontSize: 12 }}>
              Downloading… {fetching.done} of {fetching.of}
            </span>
          )}
          <button className="btn btn-primary" style={{ fontSize: 12.5 }} disabled={!picked.size || !!fetching} onClick={review}>
            {picked.size ? `Review and import ${picked.size}` : "Review and import"}
          </button>
        </span>
      </div>
      {error && <span style={{ fontSize: 12.5, color: "var(--color-danger, #b3261e)" }}>{error}</span>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r) => (
          <label
            key={r.id}
            style={{ display: "grid", gridTemplateColumns: "18px 1fr auto", gap: 10, alignItems: "baseline", padding: "6px 0", borderTop: "1px solid var(--line-1)", cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={picked.has(r.id)}
              disabled={!!fetching}
              onChange={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  if (n.has(r.id)) n.delete(r.id);
                  else n.add(r.id);
                  return n;
                })
              }
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>
              <span className="meta" style={{ fontSize: 11.5 }}>
                {r.recordedOn ? `${r.recordedOn}${r.time ? ` · ${r.time}` : ""}` : `Added ${r.createdTime.slice(0, 10)}`} · {r.sharedDrive ? "Shared drive" : "My Drive"}
              </span>
            </span>
            <span style={{ display: "flex", gap: 10, fontSize: 12 }}>
              {r.link && (
                <a href={r.link} target="_blank" rel="noreferrer" className="meta" onClick={(e) => e.stopPropagation()}>
                  Drive ↗
                </a>
              )}
              <button
                type="button"
                className="meta"
                disabled={!!fetching}
                onClick={(e) => {
                  e.preventDefault();
                  dismiss(r);
                }}
                title="Stop showing it here; you can bring it back from Import from Google Meet"
                style={{ border: 0, background: "none", cursor: "pointer", fontSize: 12 }}
              >
                Not an interview
              </button>
            </span>
          </label>
        ))}
      </div>
      {incoming && (
        <UploadDialog
          directory={directory}
          incoming={incoming}
          onClose={() => {
            setIncoming(null);
            loadWaiting().then(apply);
          }}
        />
      )}
    </div>
  );
}
