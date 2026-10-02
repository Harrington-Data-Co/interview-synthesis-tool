import { withBase } from "@/lib/basePath";
/** Call a deck's edit route. */
export async function deckAction(productId: string, body: Record<string, unknown>): Promise<{ error: string | null; result?: unknown }> {
  const res = await fetch(withBase(`/api/decks/${productId}/slides`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) return { error: b.error ?? `Request failed (${res.status}).` };
  return { error: null, result: b.result };
}
