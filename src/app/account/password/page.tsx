"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MIN = 10;

/** Choose a password: the first time, from an invitation; later, from a
 *  reset link or the account menu. Needs a session, which the link (or
 *  being signed in) gives. */
export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (password !== again) return setError("The two passwords don't match.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.push("/");
    router.refresh();
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "var(--space-6)" }}>
      <form
        onSubmit={save}
        className="panel"
        style={{ width: "min(420px,100%)", padding: "var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <span className="hdc-brand" style={{ fontSize: 18 }}>
          Harrington <span>Tools</span>
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Choose a password</h2>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--color-muted)" }}>
            At least {MIN} characters. You&apos;ll sign in with it and your email address from now on.
          </p>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span className="kicker" style={{ fontSize: 10 }}>
            New password
          </span>
          <input className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span className="kicker" style={{ fontSize: 10 }}>
            The same again
          </span>
          <input className="input" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {error && (
          <div role="alert" style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--color-accent-600)", background: "var(--color-accent-100)", fontSize: 12.5, color: "var(--color-navy)" }}>
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Saving…" : "Save and continue"}
        </button>
      </form>
    </div>
  );
}
