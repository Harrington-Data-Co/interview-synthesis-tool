import { withBase } from "@/lib/basePath";
export type LabelAxis = { id: string; name: string; options: { id: string; value: string }[] };

/** transcriptId → axisId → optionId */
export type LabelMap = Record<string, Record<string, string>>;

/** Call the project's labels route. Resolves to an error message, or to the
 *  id of whatever was created (for addAxis / addOption). */
export async function labelAction(
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ error: string | null; id?: string }> {
  const res = await fetch(withBase(`/api/projects/${projectId}/labels`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).` };
  return { error: null, id: b.id };
}
