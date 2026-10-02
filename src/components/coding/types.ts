import { withBase } from "@/lib/basePath";
export const CODE_TYPES = ["Pain", "Step", "Tool", "Goal", "Constraint", "Question", "Quote", "Stakeholder"] as const;
export type CodeType = (typeof CODE_TYPES)[number];

export type LineRow = {
  n: number;
  speaker: string; // display name, or the name as written
  role: "interviewer" | "participant" | "other";
  text: string;
};

export type CodeRow = {
  id: string;
  ref: string;
  type: CodeType;
  label: string;
  verbatim: string;
  note: string | null;
  line_start: number;
  line_end: number;
  origin: "claude" | "human";
  merged_into_id: string | null;
  /** The latest edit that can still be reverted, if any. */
  lastEdit: { text: string; by: string; at: string } | null;
};

export type RejectionRow = {
  id: string;
  reason: string;
  proposal: {
    line_start?: number;
    line_end?: number;
    type?: string;
    label?: string;
    verbatim?: string;
    note?: string;
  };
};

export type RunRow = {
  id: string;
  status: "running" | "done" | "failed";
  started_at: string;
  started_by: string;
  accepted: number | null;
  rejected: number | null;
  cost_usd: number | null;
  error: string | null;
  served_by: string | null;
};

/** Call the transcript's codes route. Resolves to an error message or null. */
export async function codeAction(
  transcriptId: string,
  body: Record<string, unknown>,
): Promise<{ error: string | null; result?: unknown }> {
  const res = await fetch(withBase(`/api/transcripts/${transcriptId}/codes`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).` };
  return { error: null, result: b.result };
}

export const addr = (c: { line_start: number; line_end: number }) =>
  c.line_start === c.line_end ? `L${c.line_start}` : `L${c.line_start}–${c.line_end}`;
