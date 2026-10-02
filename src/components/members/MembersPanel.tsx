"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Notice } from "@/components/ui";
import { withBase } from "@/lib/basePath";

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  initials: string;
  /** The project role, or on the workspace page the workspace role (null:
   *  someone from outside). */
  role: string | null;
  clientAccess?: "deliverables" | "full";
  /** Workspace page: the projects they're on. */
  projects?: string[];
  /** "signed in 3 days ago", when the viewer may see it. */
  lastSignIn?: string;
  you: boolean;
};

export type InviteRow = {
  id: string;
  email: string;
  name: string | null;
  /** What accepting gives, in words ("Editor on Project A"). */
  gives: string;
  /** Whole days until it expires; 0 or less once it has. */
  daysLeft: number;
  sentCount: number;
  /** The invitation also grants a workspace role: only an owner may resend it. */
  canSend: boolean;
};

type Scope = { kind: "project"; projectId: string; projectName: string } | { kind: "workspace" };

export const PROJECT_ROLES = [
  ["owner", "Owner", "Everything an editor can, plus members and invitations."],
  ["editor", "Editor", "Adds transcripts; codes, notes, themes and every deliverable."],
  ["viewer", "Viewer", "Reads everything; changes nothing."],
  ["client", "Client", "Reads the deliverables. See below."],
] as const;

const WORKSPACE_ROLES = [
  ["owner", "Owner", "Sees and manages every project and every member."],
  ["editor", "Editor", "Starts projects; edits People, Organizations and the template library; uploads to Unassigned."],
  ["viewer", "Viewer", "Reads People, Organizations and the template library."],
  ["", "None", "From outside Harrington: sees only the projects they're invited to."],
] as const;

export const CLIENT_ACCESS = [
  ["deliverables", "Deliverables", "The memo, deck, process flows and architecture, confirmed themes, and the quotes they cite — by title, never by name. No transcripts, notes or people."],
  ["full", "Everything, read-only", "Also the transcripts, codes, notes, chain and corpus, with names. Changes nothing."],
] as const;

const roleLabel = (scope: Scope, role: string | null) =>
  (scope.kind === "project" ? PROJECT_ROLES : WORKSPACE_ROLES).find(([k]) => k === (role ?? ""))?.[1] ?? role ?? "None";

/** Who's on a project (or the workspace) and the invitations still open:
 *  change roles, remove people, invite, send again, copy a link, withdraw.
 *  The database decides who may do which; manage only decides what's shown. */
export function MembersPanel({
  scope,
  members,
  invites,
  manage,
}: {
  scope: Scope;
  members: MemberRow[];
  invites: InviteRow[];
  manage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  async function call(key: string, url: string, init: RequestInit, done?: (body: Record<string, unknown>) => void) {
    setBusy(key);
    setError("");
    setNote("");
    const res = await fetch(withBase(url), { ...init, headers: { "content-type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(body.error ?? `That didn't work (${res.status}).`);
    done?.(body);
    router.refresh();
  }

  const memberUrl = (userId: string) =>
    scope.kind === "project" ? `/api/projects/${scope.projectId}/members` : `/api/members/${userId}`;

  function setRole(m: MemberRow, role: string, clientAccess?: string) {
    if (scope.kind === "project")
      call(m.userId, memberUrl(m.userId), { method: "PATCH", body: JSON.stringify({ userId: m.userId, role, clientAccess }) });
    else call(m.userId, memberUrl(m.userId), { method: "PATCH", body: JSON.stringify({ role: role || null }) });
  }

  function remove(m: MemberRow) {
    setConfirming(null);
    if (scope.kind === "project")
      call(m.userId, `${memberUrl(m.userId)}?userId=${m.userId}`, { method: "DELETE" }, () => {
        if (m.you) router.push("/");
      });
    else call(m.userId, memberUrl(m.userId), { method: "DELETE" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: 860 }}>
      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice>{note}</Notice>}

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="kicker">{scope.kind === "project" ? `On ${scope.projectName}` : "Everyone with a seat"}</span>
        {!members.length && <p className="meta">No one yet.</p>}
        {members.map((m) => (
          <div
            key={m.userId}
            style={{
              display: "grid",
              gridTemplateColumns: "32px minmax(0,1fr) auto",
              gap: "var(--space-3)",
              alignItems: "center",
              padding: "var(--space-2) var(--space-3)",
              border: "1px solid var(--color-divider)",
              background: "var(--color-surface)",
            }}
          >
            <Avatar initials={m.initials} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                {m.name}
                {m.you && <span className="meta"> · you</span>}
              </span>
              <span className="meta" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.email}
                {m.lastSignIn ? ` · ${m.lastSignIn}` : ""}
                {m.projects && (m.projects.length ? ` · ${m.projects.join(", ")}` : " · no projects")}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {manage && !(scope.kind === "workspace" && m.you) ? (
                <>
                  <select
                    className="input"
                    aria-label={`${m.name}'s role`}
                    value={m.role ?? ""}
                    disabled={busy === m.userId}
                    onChange={(e) => setRole(m, e.target.value, m.clientAccess)}
                    style={{ fontSize: 12.5, width: "auto" }}
                  >
                    {(scope.kind === "project" ? PROJECT_ROLES : WORKSPACE_ROLES).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {scope.kind === "project" && m.role === "client" && (
                    <select
                      className="input"
                      aria-label={`What ${m.name} sees`}
                      value={m.clientAccess ?? "deliverables"}
                      disabled={busy === m.userId}
                      onChange={(e) => setRole(m, "client", e.target.value)}
                      style={{ fontSize: 12.5, width: "auto" }}
                    >
                      {CLIENT_ACCESS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              ) : (
                <span className={`tag ${m.role === "owner" ? "tag-accent" : m.role === "editor" ? "tag-outline" : "tag-neutral"}`}>
                  {roleLabel(scope, m.role)}
                  {m.role === "client" && m.clientAccess === "full" ? " · everything" : ""}
                </span>
              )}
              {(manage || (scope.kind === "project" && m.you)) &&
                !(scope.kind === "workspace" && m.you) &&
                (confirming === m.userId ? (
                  <>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy === m.userId} onClick={() => remove(m)}>
                      {m.you ? "Leave" : scope.kind === "project" ? "Remove" : "Remove from everything"}
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirming(m.userId)}>
                    {m.you ? "Leave" : "Remove"}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </section>

      {manage && invites.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="kicker">Invited, not yet signed in</span>
          {invites.map((i) => {
            const days = i.daysLeft;
            return (
              <div
                key={i.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "var(--space-2) var(--space-3)",
                  border: "1px dashed var(--color-divider)",
                }}
              >
                <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.name ?? i.email}</span>
                    <span className="meta" style={{ fontSize: 12 }}>
                      {i.name ? `${i.email} · ` : ""}
                      {i.gives} ·{" "}
                      {days > 0 ? `expires in ${days} day${days === 1 ? "" : "s"}` : <strong>expired</strong>}
                      {i.sentCount > 1 ? ` · sent ${i.sentCount} times` : ""}
                    </span>
                  </div>
                  {i.canSend && (
                    <>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        disabled={busy === i.id}
                        onClick={() =>
                          call(i.id, `/api/invitations/${i.id}`, { method: "POST" }, (b) =>
                            setNote(b.emailed ? `Sent again to ${i.email}.` : String(b.note ?? "Not emailed.")),
                          )
                        }
                      >
                        Send again
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        disabled={busy === i.id}
                        title="A link to pass on yourself. It replaces any link already emailed."
                        onClick={() => call(i.id, `/api/invitations/${i.id}/link`, { method: "POST" }, (b) => setLink({ id: i.id, url: String(b.link) }))}
                      >
                        Copy link
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy === i.id} onClick={() => call(i.id, `/api/invitations/${i.id}`, { method: "DELETE" })}>
                        Withdraw
                      </button>
                    </>
                  )}
                </div>
                {link?.id === i.id && <CopyLink url={link.url} onDone={() => setLink(null)} />}
              </div>
            );
          })}
        </section>
      )}

      {manage && <InviteForm scope={scope} onDone={(msg) => { setNote(msg); router.refresh(); }} />}
    </div>
  );
}

function InviteForm({ scope, onDone }: { scope: Scope; onDone: (message: string) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("editor");
  const [clientAccess, setClientAccess] = useState("deliverables");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const roles = scope.kind === "project" ? PROJECT_ROLES : WORKSPACE_ROLES.filter(([k]) => k);
  const described = roles.find(([k]) => k === role)?.[2];

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(withBase("/api/invitations"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        scope.kind === "project"
          ? { email, name, projectId: scope.projectId, projectRole: role, clientAccess }
          : { email, name, workspaceRole: role },
      ),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Couldn't invite (${res.status}).`);
    const who = name.trim() || email.trim();
    setEmail("");
    setName("");
    onDone(
      body.status === "added"
        ? `${who} already had a seat, so they're in now.`
        : body.emailed
          ? `Invitation sent to ${email.trim()}. It's good for 14 days.`
          : `${who} is invited, but the email didn't go: ${body.note ?? "unknown reason"} Use Copy link below to send it yourself.`,
    );
  }

  return (
    <form onSubmit={send} className="panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span className="kicker">{scope.kind === "project" ? `Invite someone to ${scope.projectName}` : "Invite someone from Harrington"}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "var(--space-3)" }}>
        <Field label="Email">
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Name" hint="Optional; they can be renamed later.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dana Smith" />
        </Field>
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {scope.kind === "project" && role === "client" && (
          <Field label="They see">
            <select className="input" value={clientAccess} onChange={(e) => setClientAccess(e.target.value)}>
              {CLIENT_ACCESS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <p className="meta" style={{ margin: 0, fontSize: 12.5 }}>
        {role === "client" ? CLIENT_ACCESS.find(([k]) => k === clientAccess)?.[2] : described}
        {scope.kind === "workspace" && " People from outside Harrington are invited from a project's Members tab instead."}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <button className="btn btn-primary" disabled={busy || !email.trim()}>
          {busy ? "Inviting…" : "Send invitation"}
        </button>
      </div>
    </form>
  );
}

function CopyLink({ url, onDone }: { url: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 200, fontSize: 12 }} aria-label="Invite link" />
      <button
        className="btn btn-secondary"
        style={{ fontSize: 12 }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onDone}>
        Done
      </button>
      <span className="meta" style={{ fontSize: 11.5, flexBasis: "100%" }}>
        Works once, for this person only. Making it replaced any link already emailed to them.
      </span>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        fontWeight: 700,
        fontSize: 11.5,
        background: "var(--color-accent-800)",
        color: "#FFFFFF",
      }}
    >
      {initials}
    </span>
  );
}
