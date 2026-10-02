"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Directory } from "@/lib/directory";
import { DriveInbox } from "./DriveInbox";
import { MeetImport } from "./MeetImport";
import { withBase } from "@/lib/basePath";

/** Connect or disconnect Google Drive, where Google Meet saves transcripts. */
export function GoogleConnection({
  state,
  email,
  editor,
  notice,
  directory,
}: {
  state: "unconfigured" | "needs-migration" | "disconnected" | "connected";
  email: string | null;
  editor: boolean;
  notice: { tone: "info" | "error"; text: string } | null;
  directory: Directory;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch(withBase("/api/connectors/google"), { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't disconnect.");
    router.replace("/sources");
    router.refresh();
  }

  return (
    <div className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Google Meet</span>
          <span className="meta" style={{ fontSize: 12.5 }}>
            {state === "connected"
              ? `Connected to Google Drive as ${email}. Meet transcripts are read from there; nothing in Drive is changed.`
              : state === "unconfigured"
                ? "Not set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local (see the README)."
                : state === "needs-migration"
                  ? "Apply migration 20260929e_google_connector.sql to turn this on."
                  : "Connect Google Drive to import Meet transcripts without downloading them first. Read-only."}
          </span>
        </div>
        {editor && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
            {state === "disconnected" && (
              // A plain link: the start route redirects to Google.
              <a className="btn btn-primary" href={withBase("/api/connectors/google/start")} style={{ fontSize: 12.5 }}>
                Connect Google Drive
              </a>
            )}
            {state === "connected" && (
              <>
                <button className="btn btn-secondary" onClick={() => setImporting(true)} style={{ fontSize: 12.5 }}>
                  Browse and search Drive
                </button>
                <button className="btn btn-ghost" onClick={disconnect} disabled={busy} style={{ fontSize: 12.5 }}>
                  {busy ? "Disconnecting…" : "Disconnect"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {state === "connected" && editor && <DriveInbox directory={directory} />}
      {importing && <MeetImport directory={directory} onClose={() => setImporting(false)} />}
      {(notice || error) && (
        <p style={{ margin: 0, fontSize: 12.5, color: error || notice?.tone === "error" ? "var(--color-danger, #b3261e)" : "var(--color-accent-800)" }}>
          {error ?? notice?.text}
        </p>
      )}
    </div>
  );
}
