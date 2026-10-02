"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Notice } from "@/components/ui";
import { withBase } from "@/lib/basePath";
import { createClient } from "@/lib/supabase/client";

type Access = { project: string; client: string | null; role: string; clientAccess: string };

const WORKSPACE_ROLE: Record<string, string> = {
  owner: "Workspace owner: every project, every member, and Settings.",
  editor: "Workspace editor: starts projects; edits People, Organizations and the template library.",
  viewer: "Workspace viewer: reads People, Organizations and the template library.",
};

export function AccountView({
  name,
  initials,
  title,
  email,
  workspaceRole,
  allProjects,
  access,
}: {
  name: string;
  initials: string;
  title: string | null;
  email: string;
  workspaceRole: string | null;
  allProjects: boolean;
  access: Access[];
}) {
  return (
    <>
      <Profile name={name} initials={initials} title={title} />
      <SignIn email={email} />
      <section className="panel" style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span className="kicker">What you can get at</span>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          {workspaceRole ? WORKSPACE_ROLE[workspaceRole] : "Invited from outside Harrington: just the projects below."}
        </p>
        {allProjects && <p className="meta" style={{ margin: 0 }}>As a workspace owner you see every project, whether or not you&apos;re on it.</p>}
        {access.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Project</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {access.map((a, i) => (
                <tr key={i}>
                  <td>{a.client ?? "—"}</td>
                  <td>{a.project}</td>
                  <td style={{ textTransform: "capitalize" }}>
                    {a.role}
                    {a.role === "client" ? (a.clientAccess === "full" ? " · everything, read-only" : " · deliverables") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="meta" style={{ margin: 0 }}>You&apos;re not on any project yet.</p>
        )}
      </section>
    </>
  );
}

function Profile({ name: initialName, initials: initialInitials, title: initialTitle }: { name: string; initials: string; title: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [initials, setInitials] = useState(initialInitials);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const changed = name !== initialName || initials !== initialInitials || title !== (initialTitle ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch(withBase("/api/account"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, initials, title }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "error", text: body.error ?? `Couldn't save (${res.status}).` });
    setMessage({ tone: "info", text: "Saved." });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="panel" style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span className="kicker">Profile</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "var(--space-3)" }}>
        <Field label="Name">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Initials" hint="Up to three; blank works them out from your name.">
          <input className="input" maxLength={3} value={initials} onChange={(e) => setInitials(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lead researcher" />
        </Field>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div>
        <button className="btn btn-primary" disabled={busy || !changed || !name.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function SignIn({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  async function signOutOthers() {
    setBusy(true);
    setMessage(null);
    const { error } = await createClient().auth.signOut({ scope: "others" });
    setBusy(false);
    setMessage(error ? { tone: "error", text: error.message } : { tone: "info", text: "Signed out everywhere else. This browser stays signed in." });
  }

  return (
    <section className="panel" style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span className="kicker">Signing in</span>
      <p style={{ margin: 0, fontSize: 13.5 }}>
        You sign in as <strong>{email}</strong> with a password. To use a different address, ask a workspace owner.
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <a className="btn btn-secondary" href={withBase("/account/password")}>
          Change password
        </a>
        <button className="btn btn-ghost" disabled={busy} onClick={signOutOthers}>
          {busy ? "Signing out…" : "Sign out of other devices"}
        </button>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </section>
  );
}
