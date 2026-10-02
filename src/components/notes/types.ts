import { withBase } from "@/lib/basePath";
export type NoteSectionView = { id: string; name: string; requires: string[]; note: string | null };

export type NoteTemplateView = { id: string; name: string; scope: string | null; sections: NoteSectionView[] };

export type NoteCodeView = {
  id: string;
  ref: string;
  type: string;
  label: string;
  verbatim: string;
  line_start: number;
  line_end: number;
  merged_into_id: string | null;
};

export type NoteItemView = {
  id: string;
  sectionId: string;
  ordinal: number;
  text: string;
  origin: "claude" | "human";
  codeIds: string[];
  lastEdit: { text: string; by: string } | null;
};

export type CoverageRow = { code_id: string; ref: string; type: string; label: string; used: boolean };

export type NoteRejectionView = {
  id: string;
  reason: string;
  proposal: { section?: string; section_id?: string; text?: string; refs?: string[]; code_ids?: string[] };
};

export type NoteRunView = {
  status: "running" | "done" | "failed";
  started_at: string;
  started_by: string;
  accepted: number | null;
  rejected: number | null;
  cost_usd: number | null;
  error: string | null;
};

export async function itemAction(
  noteId: string,
  body: Record<string, unknown>,
): Promise<{ error: string | null; result?: unknown }> {
  const res = await fetch(withBase(`/api/notes/${noteId}/items`), {
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
