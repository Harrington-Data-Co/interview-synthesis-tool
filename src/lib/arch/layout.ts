/** Columns for an architecture map: each system sits one column to the right
 *  of the furthest system that feeds it, so data reads left to right. A
 *  cycle is broken at the edge that would close it. Systems with no flows
 *  sit in the first column. */
export function layers(ids: string[], edges: [string, string][]): Record<string, number> {
  const out = new Map<string, string[]>();
  for (const [a, b] of edges) out.set(a, [...(out.get(a) ?? []), b]);
  // Drop edges that close a cycle (depth-first, in the order given).
  const state = new Map<string, "open" | "done">();
  const kept: [string, string][] = [];
  const visit = (id: string) => {
    state.set(id, "open");
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === "open") continue;
      kept.push([id, to]);
      if (!state.has(to)) visit(to);
    }
    state.set(id, "done");
  };
  for (const id of ids) if (!state.has(id)) visit(id);

  const layer: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  // Longest path over the acyclic edges; at most ids.length rounds.
  for (let round = 0; round < ids.length; round++) {
    let changed = false;
    for (const [a, b] of kept) {
      if (layer[b] < layer[a] + 1) {
        layer[b] = layer[a] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}
