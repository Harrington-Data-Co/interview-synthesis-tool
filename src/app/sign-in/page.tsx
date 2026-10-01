"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/config";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "reset">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
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
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email: typed, password });
      setBusy(false);
      if (error) {
        setErr(
          /invalid login credentials/i.test(error.message)
            ? "That email and password don't match. If you haven't set a password yet, use Forgot your password."
            : error.message,
        );
        return;
      }
      router.push("/");
      router.refresh();
      return;
    }

    // The reset link lands on /auth/confirm, which asks for a click before
    // using it, then on the set-a-password page.
    const { error } = await supabase.auth.resetPasswordForEmail(typed, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/account/password`,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  const switchTo = (m: "password" | "reset") => {
    setMode(m);
    setErr("");
    setSent(false);
  };

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
          onSubmit={submit}
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
            <h2 style={{ fontSize: 28, margin: "4px 0 0" }}>
              {mode === "password" ? "Sign in to Harrington Tools" : "Set or reset your password"}
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--color-muted)" }}>
              {mode === "password"
                ? "Use the email address your invitation went to."
                : "We'll email a link to choose a new password. Use this the first time, too, if you haven't set one."}
            </p>
          </div>

          <SignInField label="Email">
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr("");
              }}
              placeholder="you@example.com"
            />
          </SignInField>

          {mode === "password" && (
            <SignInField label="Password">
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErr("");
                }}
              />
            </SignInField>
          )}

          {err && (
            <div
              role="alert"
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
              If <strong>{email}</strong> has an account, a link to set a password is on its way. It expires in an hour.
            </div>
          ) : (
            <button type="submit" className="btn btn-primary btn-block" disabled={busy} style={{ justifyContent: "center" }}>
              {busy ? (mode === "password" ? "Signing in…" : "Sending…") : mode === "password" ? "Sign in" : "Email me a link"}
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            style={{ alignSelf: "flex-start", fontSize: 12.5, padding: 0 }}
            onClick={() => switchTo(mode === "password" ? "reset" : "password")}
          >
            {mode === "password" ? "Forgot your password?" : "← Back to sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function SignInField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
