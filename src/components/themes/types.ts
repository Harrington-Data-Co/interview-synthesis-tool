import type { EvidenceCode, EvidenceInterview } from "@/lib/themes/evidence";

export type { EvidenceCode, EvidenceInterview };

export type ThemeView = {
  id: string;
  ref: string;
  title: string;
  description: string | null;
  status: "proposed" | "confirmed";
  origin: "claude" | "human";
  codeIds: string[];
  citedByMemo: boolean;
  lastEdit: { text: string; by: string } | null;
};

export type ThemeRejectionView = {
  id: string;
  reason: string;
  proposal: { title?: string; description?: string; codes?: string[]; code_ids?: string[] };
};

export type ThemeRunView = {
  status: "running" | "done" | "failed";
  started_at: string;
  started_by: string;
  accepted: number | null;
  rejected: number | null;
  cost_usd: number | null;
  error: string | null;
};

export async function themeAction(
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ error: string | null; result?: unknown }> {
  const res = await fetch(`/api/projects/${projectId}/themes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).` };
  return { error: null, result: b.result };
}
