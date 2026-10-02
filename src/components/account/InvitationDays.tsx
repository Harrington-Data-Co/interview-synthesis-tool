"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";
import { withBase } from "@/lib/basePath";

/** How long a new invitation lasts, and how far Send again extends one. */
export function InvitationDays({ days: initial }: { days: number }) {
  const router = useRouter();
  const [days, setDays] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch(withBase("/api/settings"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationDays: Number(days) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "error", text: body.error ?? `Couldn't save (${res.status}).` });
    setMessage({ tone: "info", text: "Saved. Invitations already out keep their dates until they're sent again." });
    router.refresh();
  }

  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
        An invitation lasts
        <input className="input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 80 }} />
        days.
        <button className="btn btn-secondary" disabled={busy || Number(days) === initial}>
          {busy ? "Saving…" : "Save"}
        </button>
      </label>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}
