/** The chain board's graph: transcript line → code → note item, code →
 *  theme → memo paragraph, and code → memo paragraph for direct citations.
 *  Pure, so reachability is tested without a browser. */

export type Edge = { a: string; b: string };

/** Everything upstream and downstream of one node, and the node itself.
 *  Walks forward along edges and backward along edges separately, so picking
 *  a theme lights its codes and paragraphs but not its codes' other themes. */
export function reach(edges: Edge[], node: string): Set<string> {
  const fwd = new Map<string, string[]>();
  const back = new Map<string, string[]>();
  for (const e of edges) {
    (fwd.get(e.a) ?? fwd.set(e.a, []).get(e.a)!).push(e.b);
    (back.get(e.b) ?? back.set(e.b, []).get(e.b)!).push(e.a);
  }
  const all = new Set([node]);
  for (const next of [fwd, back]) {
    const seen = new Set([node]);
    const todo = [node];
    while (todo.length) {
      for (const n of next.get(todo.pop()!) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        all.add(n);
        todo.push(n);
      }
    }
  }
  return all;
}

export type LineRow = { kind: "line"; n: number } | { kind: "gap"; from: number; to: number };

/** The transcript column: every line some code covers, plus `context` lines
 *  before each run of them (usually the question that prompted it). Runs of
 *  other lines fold into one gap row. */
export function foldLines(lineNumbers: number[], ranges: { start: number; end: number }[], context = 1): LineRow[] {
  const keep = new Set<number>();
  for (const r of ranges) for (let n = r.start - context; n <= r.end; n++) keep.add(n);
  const rows: LineRow[] = [];
  let gap: { from: number; to: number } | null = null;
  for (const n of lineNumbers) {
    if (keep.has(n)) {
      if (gap) rows.push({ kind: "gap", ...gap });
      gap = null;
      rows.push({ kind: "line", n });
    } else if (gap) gap.to = n;
    else gap = { from: n, to: n };
  }
  if (gap) rows.push({ kind: "gap", ...gap });
  return rows;
}
