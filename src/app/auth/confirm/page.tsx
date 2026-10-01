"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

type OtpType = "invite" | "magiclink" | "signup" | "email" | "recovery" | "email_change";

/** Where invitation links land. They come in three shapes, depending on how
 *  they were made: ?token_hash=&type= (a copied invite link), #access_token=
 *  (Supabase's own invite email), or ?code= (a sign-in started in this
 *  browser). Each becomes a session; the app then accepts the invitation on
 *  the first page it loads. */
export default function ConfirmPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      // This page reads the link itself, once; left on, the client would
      // also try to, and use up the code before we could.
      const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { detectSessionInUrl: false } });
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      let failure: string | null = null;

      if (query.get("token_hash")) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: query.get("token_hash")!,
          type: (query.get("type") as OtpType) ?? "invite",
        });
        failure = error?.message ?? null;
      } else if (hash.get("access_token") && hash.get("refresh_token")) {
        const { error } = await supabase.auth.setSession({
          access_token: hash.get("access_token")!,
          refresh_token: hash.get("refresh_token")!,
        });
        failure = error?.message ?? null;
      } else if (query.get("code")) {
        const { error } = await supabase.auth.exchangeCodeForSession(query.get("code")!);
        failure = error?.message ?? null;
      } else {
        failure = hash.get("error_description") ?? "This link is missing its sign-in details.";
      }

      if (failure) setError(failure);
      // A full load, so the server sees the new session cookies.
      else window.location.replace("/");
    })();
  }, []);

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
              {error}. Links work once and expire. If you were invited, sign in with the same email address and
              we&apos;ll send a fresh one.
            </p>
            <a href="/sign-in" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
              Go to sign in
            </a>
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--color-muted)" }}>Signing you in…</p>
        )}
      </div>
    </div>
  );
}
