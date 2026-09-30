/** One organization in a pasted outline, with what's nested under it. */
export type OutlineNode = { name: string; short_name: string | null; kind: string | null; children: OutlineNode[] };

/** Read an indented outline into a tree of organizations. Indentation (spaces
 *  or tabs) sets the nesting; list bullets ("-", "*", "•", "1.") are ignored.
 *  A line may end with a short name in parentheses and a kind in brackets,
 *  in either order: "Department of Education (DOE) [Department]". `levelKinds`
 *  gives a kind to every node at a depth (0 = top) that doesn't name its own. */
export function parseOutline(text: string, levelKinds: string[] = []): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { indent: number; node: OutlineNode }[] = [];
  for (const raw of text.replace(/\t/g, "    ").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    let line = raw.trim().replace(/^([-*•·]|\d+[.)])\s+/, "");
    let kind: string | null = null;
    let short: string | null = null;
    // Trailing [Kind] and (SHORT), in either order.
    for (let i = 0; i < 2; i++) {
      const k = line.match(/\s*\[([^\]]+)\]\s*$/);
      if (k && !kind) {
        kind = k[1].trim() || null;
        line = line.slice(0, k.index).trim();
        continue;
      }
      const s = line.match(/\s*\(([^()]+)\)\s*$/);
      if (s && !short) {
        short = s[1].trim() || null;
        line = line.slice(0, s.index).trim();
      }
    }
    if (!line) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const depth = stack.length;
    const node: OutlineNode = { name: line, short_name: short, kind: kind ?? (levelKinds[depth]?.trim() || null), children: [] };
    (depth ? stack[depth - 1].node.children : roots).push(node);
    stack.push({ indent, node });
  }
  return roots;
}

/** How many organizations an outline holds, and how deep it goes. */
export function outlineSize(nodes: OutlineNode[]): { count: number; depth: number } {
  let count = 0;
  let depth = 0;
  const walk = (ns: OutlineNode[], d: number) => {
    for (const n of ns) {
      count++;
      depth = Math.max(depth, d + 1);
      walk(n.children, d + 1);
    }
  };
  walk(nodes, 0);
  return { count, depth };
}
