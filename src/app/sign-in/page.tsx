"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/config";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr("");

    const typed = email.trim().toLowerCase();
    if (!typed) return;

    if (!supabaseConfigured) {
      setErr(
        "Supabase isn't configured yet — copy .env.local.example to .env.local and fill in the project URL and anon key.",
      );
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: typed,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);

    // An address with no invitation is refused by the sign-up hook, whose
    // message says so.
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))",
        minHeight: "100vh",
      }}
    >
      {/* left: the promise the tool makes */}
      <div
        style={{
          background: "var(--color-navy)",
          color: "#FFFFFF",
          padding: "var(--space-8) var(--space-6)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="hdc-brand" style={{ fontSize: 21, color: "#FFFFFF" }}>
            Harrington Data <span style={{ color: "#8FD3BF" }}>Co</span>
          </span>
          <span
            style={{ fontSize: 12, fontWeight: 600, color: "var(--color-navy-muted)" }}
          >
            tools.harringtondata.com
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            maxWidth: "36ch",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#8FD3BF",
            }}
          >
            Interview Synthesis
          </span>
          <h1
            style={{
              fontSize: "clamp(32px,3.6vw,44px)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.08,
              margin: 0,
              color: "#FFFFFF",
            }}
          >
            Every finding keeps its source line.
          </h1>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.65,
              margin: 0,
              color: "var(--color-navy-muted)",
            }}
          >
            Transcripts are ingested once and never altered. Everything built on top of
            them — codes, notes, themes, the deliverable — is a working document:
            editable, attributed, reversible.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--color-navy-muted)",
          }}
        >
          <span style={{ fontWeight: 600, color: "#FFFFFF" }}>
            One Harrington account for every tool here.
          </span>
          <span>
            Interview Synthesis is the first. The next tools use the same sign-in, roles
            and audit trail.
          </span>
        </div>
      </div>

      {/* right: the actual door */}
      <div
        style={{
          display: "grid",
          placeItems: "center",
          padding: "var(--space-8) var(--space-6)",
        }}
      >
        <form
          onSubmit={signIn}
          className="panel"
          style={{
            width: "min(420px,100%)",
            padding: "var(--space-8)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span className="tag tag-accent" style={{ alignSelf: "flex-start" }}>
              By invitation
            </span>
            <h2 style={{ fontSize: 28, margin: "4px 0 0" }}>Sign in to Harrington Tools</h2>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.55,
                color: "var(--color-muted)",
              }}
            >
              Use the email address your invitation went to. We&apos;ll send a link
              that signs you in.
            </p>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              }}
            >
              Email
            </span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr("");
              }}
              placeholder="you@example.com"
            />
          </label>

          {err && (
            <div
              style={{
                padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--color-accent-600)",
                background: "var(--color-accent-100)",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--color-navy)",
              }}
            >
              {err}
            </div>
          )}

          {sent ? (
            <div
              style={{
                padding: "var(--space-3)",
                border: "1px solid var(--color-accent-400)",
                background: "var(--color-accent-100)",
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--color-navy)",
              }}
            >
              Check <strong>{email}</strong> — the sign-in link is on its way. It expires
              in an hour.
            </div>
          ) : (
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={busy}
              style={{ justifyContent: "center" }}
            >
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          )}

          <p
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.5,
              color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
            }}
          >
            Your account is for the whole subdomain. Roles are set per tool, so an Owner
            here can be a Viewer in the next tool. Every record already stores who made
            it.
          </p>
        </form>
      </div>
    </div>
  );
}
