"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

type OtpType = "invite" | "magiclink" | "signup" | "email" | "recovery" | "email_change";

/** Where invitation and password-reset links land. They come in three
 *  shapes: ?token_hash=&type= (a copied link, or an email template pointed
 *  here), #access_token= (Supabase's default emails, which spend the token
 *  on their way here), or ?code= (a reset started in this browser). Each
 *  becomes a session, then ?next= (the set-a-password page) or home; the
 *  app accepts any invitation on the first page it loads.
 *
 *  A token_hash link is spent only when the person clicks Continue: email
 *  scanners that open every link would otherwise use it up first. */
export default function ConfirmPage() {
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState<{ token: string; type: OtpType } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));

      if (query.get("token_hash")) {
        setWaiting({ token: query.get("token_hash")!, type: (query.get("type") as OtpType) ?? "invite" });
        return;
      }
      let failure: string | null;
      if (hash.get("access_token") && hash.get("refresh_token")) {
        const { error } = await supabase().auth.setSession({
          access_token: hash.get("access_token")!,
          refresh_token: hash.get("refresh_token")!,
        });
        failure = error?.message ?? null;
      } else if (query.get("code")) {
        const { error } = await supabase().auth.exchangeCodeForSession(query.get("code")!);
        failure = error?.message ?? null;
      } else {
        failure = hash.get("error_description") ?? "This link is missing its sign-in details";
      }
      if (failure) setError(failure);
      else onward();
    })();
  }, []);

  async function continueWithLink() {
    if (!waiting) return;
    setBusy(true);
    const { error } = await supabase().auth.verifyOtp({ token_hash: waiting.token, type: waiting.type });
    setBusy(false);
    if (error) setError(error.message);
    else onward(waiting.type === "invite" || waiting.type === "recovery" ? "/account/password" : undefined);
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "var(--space-6)" }}>
      <div className="panel" style={{ width: "min(460px,100%)", padding: "var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span className="hdc-brand" style={{ fontSize: 18 }}>
          Harrington <span>Tools</span>
        </span>
        {error ? (
          <>
            <h2 style={{ fontSize: 22 }}>That link didn&apos;t work</h2>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-muted)" }}>
              {error}. Links work once and expire. If you were invited, go to sign in and use{" "}
              <em>Forgot your password?</em> with the same email address for a fresh one.
            </p>
            <a href="/sign-in" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
              Go to sign in
            </a>
          </>
        ) : waiting ? (
          <>
            <h2 style={{ fontSize: 22 }}>{waiting.type === "invite" ? "Welcome" : "Set your password"}</h2>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-muted)" }}>
              {waiting.type === "invite"
                ? "You've been invited to Harrington Tools. Continue to choose a password for your account."
                : "Continue to choose a new password."}
            </p>
            <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={continueWithLink}>
              {busy ? "One moment…" : "Continue"}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--color-muted)" }}>Signing you in…</p>
        )}
      </div>
    </div>
  );
}

/** This page reads the link itself; left on, the client would also try to,
 *  and use up the code before we could. */
const supabase = () => createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { detectSessionInUrl: false } });

/** Off to ?next= (only a path on this site) or home, with a full load so the
 *  server sees the new session. */
function onward(fallback?: string) {
  const next = new URLSearchParams(window.location.search).get("next");
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : fallback ?? "/";
  window.location.replace(safe);
}
