import type { FlowCode } from "@/lib/flow/prompt";
import type { NodeKind } from "./prompt";

export type SystemProposal = { name: string; kind: NodeKind; official: boolean; note: string; codes: string[] };
export type FlowProposal = { from: string; to: string; carries: string; manual: boolean; note: string; codes: string[] };
export type GapProposal = { title: string; note: string; codes: string[] };
export type ArchProposal = { title: string; scope: string; systems: SystemProposal[]; flows: FlowProposal[]; gaps: GapProposal[] };

/** What save_arch_run() takes: flows join systems by index. */
export type ArchRow = {
  title: string;
  scope: string;
  nodes: { name: string; kind: NodeKind; official: boolean; note: string | null; code_ids: string[] }[];
  flows: { from: number; to: number; label: string; manual: boolean; note: string | null; code_ids: string[] }[];
  gaps: { title: string; note: string | null; code_ids: string[] }[];
};
export type ArchRejection = { proposal: Record<string, unknown>; reason: string };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/** Resolve codes and system names, and apply the database's rules: every
 *  system, flow and gap cites at least one known code; a flow joins two
 *  different systems that are on the map; one system per name. A map with
 *  no systems left is dropped. */
export function gateArch(proposals: ArchProposal[], codes: FlowCode[]): { maps: ArchRow[]; rejected: ArchRejection[] } {
  const codeByKey = new Map(codes.map((c) => [norm(c.key), c]));
  const maps: ArchRow[] = [];
  const rejected: ArchRejection[] = [];

  const cite = (keys: string[]): { ids: string[] } | { reason: string } => {
    const ks = [...new Set(keys.map(norm))];
    if (!ks.length) return { reason: "It cites nothing." };
    const unknown = ks.filter((k) => !codeByKey.has(k));
    if (unknown.length) return { reason: `${unknown.join(", ")} ${unknown.length === 1 ? "isn't a code" : "aren't codes"} in this project.` };
    return { ids: ks.map((k) => codeByKey.get(k)!.id) };
  };

  for (const m of proposals) {
    const title = clean(m.title);
    const row: ArchRow = { title, scope: clean(m.scope), nodes: [], flows: [], gaps: [] };
    const reject = (item: string, p: object, reason: string) => rejected.push({ proposal: { ...p, item, map: title }, reason });
    const index = new Map<string, number>();

    for (const s of m.systems) {
      const name = clean(s.name);
      const c = cite(s.codes);
      if (!name) reject("system", s, "The system has no name.");
      else if (index.has(name.toLowerCase())) reject("system", s, `${row.nodes[index.get(name.toLowerCase())!].name} is already on the map.`);
      else if ("reason" in c) reject("system", s, c.reason);
      else {
        index.set(name.toLowerCase(), row.nodes.length);
        row.nodes.push({ name, kind: s.kind, official: s.official, note: clean(s.note) || null, code_ids: c.ids });
      }
    }
    for (const f of m.flows) {
      const from = index.get(clean(f.from).toLowerCase());
      const to = index.get(clean(f.to).toLowerCase());
      const label = clean(f.carries);
      const c = cite(f.codes);
      if (from === undefined || to === undefined) reject("flow", f, `${from === undefined ? f.from : f.to} isn't a system on this map.`);
      else if (from === to) reject("flow", f, "A flow must join two different systems.");
      else if (!label) reject("flow", f, "The flow doesn't say what moves.");
      else if ("reason" in c) reject("flow", f, c.reason);
      else row.flows.push({ from, to, label, manual: f.manual, note: clean(f.note) || null, code_ids: c.ids });
    }
    for (const g of m.gaps) {
      // The app numbers gaps; drop any numbering Claude added anyway.
      const gt = clean(g.title).replace(/^\d+[.)]\s*/, "");
      const c = cite(g.codes);
      if (!gt) reject("gap", g, "The gap has no title.");
      else if ("reason" in c) reject("gap", g, c.reason);
      else row.gaps.push({ title: gt, note: clean(g.note) || null, code_ids: c.ids });
    }
    if (title && row.nodes.length) maps.push(row);
  }
  return { maps, rejected };
}
