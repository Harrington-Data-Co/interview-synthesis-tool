"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";

export type BatchTarget = { id: string; title: string };
type Result = { title: string; ok: boolean; text: string };

/** Run one request per interview, one at a time (each is a Claude pass of a
 *  minute or two). Asks first; while running, the status sits exactly where
 *  the button was and counts against the batch as it stood when started. A
 *  failure doesn't stop the rest; the summary says what happened to each. */
export function BatchButton({
  targets,
  label,
  confirm,
  progress,
  request,
  summarize,
}: {
  targets: BatchTarget[];
  /** e.g. "Code 5 interviews" */
  label: (n: number) => string;
  /** e.g. "Code 5 interviews? About $0.10–0.20 each" */
  confirm: (n: number) => string;
  /** e.g. "Coding" → "Coding 2 of 5: <title>…" */
  progress: string;
  request: (t: BatchTarget) => { url: string; body: unknown };
  summarize: (body: Record<string, unknown>) => string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  // `targets` shrinks as the page refreshes after each run; count against this.
  const [batch, setBatch] = useState<BatchTarget[] | null>(null);
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
      const { url, body } = request(t);
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      done.push(res.ok ? { title: t.title, ok: true, text: summarize(b) } : { title: t.title, ok: false, text: b.error ?? `failed (${res.status})` });
      setResults([...done]);
      router.refresh();
    }
    setBatch(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "flex-end" }}>
      {batch ? (
        <span className="btn" role="status" style={{ cursor: "default", fontWeight: 500 }}>
          {progress} {current + 1} of {batch.length}: {batch[current].title}…
        </span>
      ) : (
        targets.length > 0 && (
          <button className="btn btn-secondary" onClick={() => (confirming ? run() : setConfirming(true))}>
            {confirming ? confirm(targets.length) : label(targets.length)}
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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const cost = (b: Record<string, unknown>) => (typeof b.costUsd === "number" ? ` · $${b.costUsd.toFixed(2)}` : "");

/** Code every interview that hasn't been coded. */
export function CodeAllButton({ targets }: { targets: BatchTarget[] }) {
  return (
    <BatchButton
      targets={targets}
      label={(n) => `Code ${plural(n, "interview")}`}
      confirm={(n) => `Code ${plural(n, "interview")}? About $0.10–0.20 each`}
      progress="Coding"
      request={(t) => ({ url: `/api/transcripts/${t.id}/code`, body: { replace: false } })}
      summarize={(b) => `${b.accepted} codes${b.rejected ? `, ${b.rejected} for review` : ""}${cost(b)}`}
    />
  );
}

/** Write a note from one template for every coded interview that lacks one. */
export function GenerateNotesButton({
  templates,
}: {
  templates: { id: string; name: string; targets: BatchTarget[] }[];
}) {
  const [templateId, setTemplateId] = useState(templates.find((t) => t.targets.length)?.id ?? templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId);
  if (!templates.some((t) => t.targets.length)) return null;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
      {templates.length > 1 && (
        <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: "auto", fontSize: 12.5 }} aria-label="Template">
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <BatchButton
        key={templateId}
        targets={template?.targets ?? []}
        label={(n) => `Generate ${plural(n, "note")}`}
        confirm={(n) => `Generate ${plural(n, "note")} from ${template?.name}? About $0.05–0.15 each`}
        progress="Writing note"
        request={(t) => ({ url: `/api/transcripts/${t.id}/note`, body: { templateId, replace: false } })}
        summarize={(b) => `${b.accepted} items${b.rejected ? `, ${b.rejected} for review` : ""}${cost(b)}`}
      />
    </div>
  );
}
