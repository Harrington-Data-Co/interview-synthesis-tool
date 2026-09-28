"use client";

import { useState } from "react";

export type LineView = { n: number; speaker: string; text: string; at: string | null };
export type SpeakerRole = "interviewer" | "participant" | "other";

const SPEAKER_COLOR: Record<SpeakerRole, string> = {
  participant: "var(--color-navy)",
  interviewer: "var(--color-accent-800)",
  other: "var(--color-muted)",
};

const LOCK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flex: "none" }}>
    <rect x="4" y="11" width="16" height="10" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** The prototype's tryEditRaw(): any attempt to edit is met with why not. */
export function useImmutableNotice() {
  const [shown, setShown] = useState(false);
  const notice = shown ? (
    <div
      className="panel"
      role="status"
      style={{
        position: "fixed",
        right: "var(--space-6)",
        bottom: "var(--space-6)",
        zIndex: 60,
        width: "min(400px,calc(100vw - 48px))",
        padding: "var(--space-4)",
        background: "var(--color-navy)",
        color: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {LOCK}
        <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Transcripts are immutable
        </span>
      </div>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, opacity: 0.85 }}>
        Line edits are refused for every role, owners included. If a line reads wrong, say so in the code layer —
        the correction is attributed and the original stays verifiable against its checksum.
      </span>
      <button
        onClick={() => setShown(false)}
        className="btn"
        style={{ fontSize: 11.5, color: "#FFFFFF", borderColor: "rgba(242,242,243,.25)", alignSelf: "flex-start" }}
      >
        Dismiss
      </button>
    </div>
  ) : null;
  return { show: () => setShown(true), notice };
}

export function TryEditButton() {
  const { show, notice } = useImmutableNotice();
  return (
    <>
      <button onClick={show} className="btn btn-secondary" style={{ fontSize: 11.5, alignSelf: "flex-start" }}>
        Try editing a line
      </button>
      {notice}
    </>
  );
}

export function TranscriptLines({
  lines,
  roles,
  names,
  checksum,
}: {
  lines: LineView[];
  roles: Record<string, SpeakerRole>;
  /** Display names by the name as written; lines keep the written name. */
  names: Record<string, string>;
  checksum: string;
}) {
  const { show, notice } = useImmutableNotice();

  return (
    <section
      className="panel"
      style={{ background: "var(--color-surface)", padding: "0 0 var(--space-4)", maxHeight: "78vh", overflow: "auto" }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--color-navy)",
          color: "#FFFFFF",
        }}
      >
        {LOCK}
        <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          Read-only
        </span>
        <span className="mono" style={{ fontSize: 10, opacity: 0.7, marginLeft: "auto" }}>
          {checksum.slice(0, 16)}…
        </span>
      </div>
      {lines.map((ln) => (
        <div
          key={ln.n}
          id={`L${ln.n}`}
          onClick={show}
          title={`L${ln.n}${ln.at ? ` · ${ln.at}` : ""}${
            names[ln.speaker] ? ` · written as “${ln.speaker}”` : ""
          } — read-only; transcripts cannot be edited`}
          style={{
            display: "grid",
            gridTemplateColumns: "38px 1fr",
            gap: "var(--space-4)",
            padding: "5px var(--space-4)",
            boxShadow: `inset 3px 0 0 ${roles[ln.speaker] === "participant" ? "var(--color-accent-tint-border)" : "transparent"}`,
            cursor: "not-allowed",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              lineHeight: 1.7,
              textAlign: "right",
              color: "color-mix(in srgb, var(--color-text) 38%, transparent)",
            }}
          >
            L{ln.n}
          </span>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: "0.06em",
                color: SPEAKER_COLOR[roles[ln.speaker] ?? "other"],
                marginRight: 8,
              }}
            >
              {names[ln.speaker] ?? ln.speaker}
            </span>
            {ln.text}
          </p>
        </div>
      ))}
      {notice}
    </section>
  );
}
