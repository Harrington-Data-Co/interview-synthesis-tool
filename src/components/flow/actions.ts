/** Call a process map's edit route, or the project's (draw, create). */
async function post(url: string, body: Record<string, unknown>): Promise<{ error: string | null; status: number; result?: unknown }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).`, status: res.status };
  return { error: null, status: res.status, result: b.result ?? b };
}

export const flowAction = (flowId: string, body: Record<string, unknown>) => post(`/api/flows/${flowId}`, body);
export const projectFlows = (projectId: string, body: Record<string, unknown>) => post(`/api/projects/${projectId}/flows`, body);
