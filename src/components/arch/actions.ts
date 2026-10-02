import { withBase } from "@/lib/basePath";
/** Call an architecture map's edit route, or the project's (draw, create). */
async function post(url: string, body: Record<string, unknown>): Promise<{ error: string | null; status: number; result?: unknown }> {
  const res = await fetch(withBase(url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).`, status: res.status };
  return { error: null, status: res.status, result: b.result ?? b };
}

export const archAction = (mapId: string, body: Record<string, unknown>) => post(`/api/arch/${mapId}`, body);
export const projectArch = (projectId: string, body: Record<string, unknown>) => post(`/api/projects/${projectId}/arch`, body);
