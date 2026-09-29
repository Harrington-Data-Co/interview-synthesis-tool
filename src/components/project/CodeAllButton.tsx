"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";

type Target = { id: string; title: string };
type Result = { title: string; ok: boolean; text: string };

/** Code every interview in the project that hasn't been coded, one at a time
 *  (each takes a minute or two). A failure doesn't stop the rest; the summary
 *  says what happened to each. */
export function CodeAllButton({ targets }: { targets: Target[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  // The batch as it stood when Code was pressed. `targets` shrinks as the page
  // refreshes after each interview, so progress counts against this instead.
  const [batch, setBatch] = useState<Target[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  if (!targets.length && !batch && !results.length) return null;

  async function run() {
    const list = [...targets];
    setConfirming(false);
    setResults([]);
    setBatch(list);
    const done: Result[] = [];
    for (const [i, t] of list.entries()) {
      setCurrent(i);
      const res = await fetch(`/api/transcripts/${t.id}/code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replace: false }),
      });
      const b = await res.json().catch(() => ({}));
      done.push(
        res.ok
          ? {
              title: t.title,
              ok: true,
              text: `${b.accepted} codes${b.rejected ? `, ${b.rejected} for review` : ""}${typeof b.costUsd === "number" ? ` · $${b.costUsd.toFixed(2)}` : ""}`,
            }
          : { title: t.title, ok: false, text: b.error ?? `failed (${res.status})` },
      );
      setResults([...done]);
      router.refresh();
    }
    setBatch(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "flex-end" }}>
      {batch ? (
        // Same box as a button, so the status sits exactly where the button was.
        <span className="btn" role="status" style={{ cursor: "default", fontWeight: 500 }}>
          Coding {current + 1} of {batch.length}: {batch[current].title}…
        </span>
      ) : (
        targets.length > 0 && (
          <button className="btn btn-secondary" onClick={() => (confirming ? run() : setConfirming(true))}>
            {confirming
              ? `Code ${targets.length} interview${targets.length === 1 ? "" : "s"}? About $0.10–0.20 each`
              : `Code ${targets.length} interview${targets.length === 1 ? "" : "s"}`}
          </button>
        )
      )}
      {results.length > 0 && !batch && (
        <Notice tone={results.some((r) => !r.ok) ? "error" : "info"}>
          {results.map((r) => (
            <div key={r.title}>
              {r.ok ? "✓" : "✗"} {r.title} — {r.text}
            </div>
          ))}
        </Notice>
      )}
    </div>
  );
}
