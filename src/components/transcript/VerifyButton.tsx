"use client";

import { useState } from "react";
import { withBase } from "@/lib/basePath";

type Result = { match: boolean; expected: string; actual: string; checkedAt: string };

/** Re-checks the stored original against the checksum taken at ingest. */
export function VerifyButton({ transcriptId }: { transcriptId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function verify() {
    setBusy(true);
    setError("");
    const res = await fetch(withBase(`/api/transcripts/${transcriptId}/verify`), { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Couldn't verify (${res.status}).`);
    setResult(body);
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={verify} disabled={busy}>
        {busy ? "Verifying…" : "Verify checksum"}
      </button>
      {result?.match && (
        <span style={{ fontSize: 11.5, color: "var(--color-accent-800)" }}>
          ✓ Matches — verified {new Date(result.checkedAt).toLocaleTimeString()}
        </span>
      )}
      {result && !result.match && (
        <span role="alert" style={{ fontSize: 11.5, color: "var(--color-navy)", fontWeight: 700 }}>
          ✗ Mismatch — the stored file is not the one ingested. Now{" "}
          <span className="mono" style={{ fontWeight: 400 }}>{result.actual.slice(0, 16)}…</span>
        </span>
      )}
      {error && <span style={{ fontSize: 11.5, color: "var(--color-accent-800)" }}>{error}</span>}
    </span>
  );
}
