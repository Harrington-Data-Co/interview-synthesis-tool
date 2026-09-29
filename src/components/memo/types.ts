export async function memoAction(
  productId: string,
  body: Record<string, unknown>,
): Promise<{ error: string | null; result?: unknown }> {
  const res = await fetch(`/api/memos/${productId}/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).` };
  return { error: null, result: b.result };
}
