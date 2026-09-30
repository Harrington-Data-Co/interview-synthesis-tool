import type { FlowCode } from "./prompt";

export type StepProposal = { lane: string; position: number; label: string; kind: "task" | "wait" | "decision"; note: string; codes: string[] };
export type MapProposal = { title: string; scope: string; lanes: string[]; steps: StepProposal[] };

/** What save_flow_run() takes: lanes by name, steps by lane index. */
export type MapRow = {
  title: string;
  scope: string;
  lanes: string[];
  steps: { lane: number; position: number; label: string; kind: string; note: string | null; code_ids: string[] }[];
};
export type StepRejection = { proposal: StepProposal & { map: string }; reason: string };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Resolve lanes and codes (I3:STEP-02) and apply the rules the database
 *  applies again: a step's lane is one of its map's lanes; it cites at least
 *  one code, and nothing unknown (its wording may rest on it, so it's
 *  rejected whole rather than trimmed); one step per lane per position. A
 *  map keeps only the lanes someone stands in, and is dropped if no step
 *  survives. */
export function gateMaps(proposals: MapProposal[], codes: FlowCode[]): { maps: MapRow[]; rejected: StepRejection[] } {
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");
  const codeByKey = new Map(codes.map((c) => [norm(c.key), c]));
  const maps: MapRow[] = [];
  const rejected: StepRejection[] = [];

  for (const m of proposals) {
    const title = clean(m.title);
    const lanes: string[] = [];
    for (const l of m.lanes.map(clean)) if (l && !lanes.some((x) => x.toLowerCase() === l.toLowerCase())) lanes.push(l);
    const laneOf = (name: string) => lanes.findIndex((l) => l.toLowerCase() === clean(name).toLowerCase());
    const taken = new Set<string>();
    const steps: MapRow["steps"] = [];

    for (const s of m.steps) {
      const reject = (reason: string) => rejected.push({ proposal: { ...s, map: title }, reason });
      const lane = laneOf(s.lane);
      const label = clean(s.label);
      const keys = [...new Set(s.codes.map(norm))];
      const unknown = keys.filter((k) => !codeByKey.has(k));
      if (!title) reject("The map has no title.");
      else if (lane < 0) reject(`"${s.lane}" isn't one of this map's lanes.`);
      else if (!label) reject("The step has no label.");
      else if (!Number.isInteger(s.position) || s.position < 1) reject(`${s.position} isn't a position (1, 2, 3…).`);
      else if (!keys.length) reject("The step cites nothing.");
      else if (unknown.length) reject(`${unknown.join(", ")} ${unknown.length === 1 ? "isn't a code" : "aren't codes"} in this project.`);
      else if (taken.has(`${lane}:${s.position}`)) reject(`${lanes[lane]} already has a step at position ${s.position}.`);
      else {
        taken.add(`${lane}:${s.position}`);
        steps.push({ lane, position: s.position, label, kind: s.kind, note: clean(s.note) || null, code_ids: keys.map((k) => codeByKey.get(k)!.id) });
      }
    }
    if (!steps.length) continue;
    // Keep only the lanes someone stands in, re-indexing the steps.
    const used = lanes.filter((_, i) => steps.some((s) => s.lane === i));
    for (const s of steps) s.lane = used.indexOf(lanes[s.lane]);
    maps.push({ title, scope: clean(m.scope), lanes: used, steps });
  }
  return { maps, rejected };
}
