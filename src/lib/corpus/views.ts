/** The corpus views that sit beside the matrix: each theme's share of every
 *  group, a check of the memo against the matrix, what kind of evidence each
 *  theme rests on, and the chord diagram of themes that turn up together. Pure, built on
 *  the matrix rows, so the rules are tested without a database. */

import { DATA_COLORS, OTHER_COLOR } from "@/lib/palette";
import { singleBand, type Band, type ThemeRow } from "./derive";

export type GroupShare = { band: string; labelled: boolean; hit: number; size: number; share: number };

/** How much of each group raises the theme: interviews in the group that
 *  hold one of its codes, over the group's size. Raw counts favour big
 *  groups; this doesn't. */
export function groupShares(row: ThemeRow, bands: Band[]): GroupShare[] {
  return bands.map((b) => {
    const hit = b.ids.filter((id) => row.counts.has(id)).length;
    return { band: b.name, labelled: b.labelled, hit, size: b.ids.length, share: b.ids.length ? hit / b.ids.length : 0 };
  });
}

export type MemoFlag = { kind: "strong-uncited" | "cited-narrow"; reason: string } | null;

/** A theme is strong when it rests on at least a quarter of the interviews
 *  (and never fewer than three) and, when interviews are grouped, reaches
 *  more than one group. */
export function isStrong(row: ThemeRow, bands: Band[], total: number): boolean {
  if (row.ivs < Math.max(3, Math.ceil(total * 0.25))) return false;
  const labelled = bands.filter((b) => b.labelled);
  if (labelled.length < 2) return true;
  return labelled.filter((b) => b.ids.some((id) => row.counts.has(id))).length >= 2;
}

/** Where the memo and the evidence disagree: a strong theme it leaves out,
 *  or a theme it cites that rests on two interviews or fewer, or on one
 *  group. */
export function memoFlag(row: ThemeRow, bands: Band[], total: number, cited: boolean): MemoFlag {
  if (!cited)
    return isStrong(row, bands, total)
      ? { kind: "strong-uncited", reason: `Rests on ${row.ivs} of ${total} interviews, but the memo doesn't cite it.` }
      : null;
  if (row.ivs <= 2) return { kind: "cited-narrow", reason: `Cited, but rests on ${row.ivs === 1 ? "one interview" : "two interviews"}.` };
  const only = singleBand(row, bands);
  return only ? { kind: "cited-narrow", reason: `Cited, but every interview behind it is in ${only}.` } : null;
}

/** Code types folded into what they say about a theme. Stacked in this
 *  order, coloured from the shared data palette; Other takes its grey. */
export const EVIDENCE_KINDS = [
  { key: "problems", label: "Problems", types: ["Pain", "Constraint"], color: DATA_COLORS[0] },
  { key: "goals", label: "Goals", types: ["Goal"], color: DATA_COLORS[1] },
  { key: "today", label: "How it works today", types: ["Step", "Tool", "Stakeholder"], color: DATA_COLORS[2] },
  { key: "other", label: "Other", types: ["Question", "Quote"], color: OTHER_COLOR },
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]["key"];

export type EvidenceMix = { total: number; kinds: Record<EvidenceKind, number>; types: Record<string, number> };

/** A theme's codes counted by kind and by type. An unknown type counts as
 *  Other. */
export function evidenceMix(codeTypes: string[]): EvidenceMix {
  const kinds = Object.fromEntries(EVIDENCE_KINDS.map((k) => [k.key, 0])) as Record<EvidenceKind, number>;
  const types: Record<string, number> = {};
  for (const t of codeTypes) {
    const kind = EVIDENCE_KINDS.find((k) => (k.types as readonly string[]).includes(t))?.key ?? "other";
    kinds[kind]++;
    types[t] = (types[t] ?? 0) + 1;
  }
  return { total: codeTypes.length, kinds, types };
}

/** The kind a theme's evidence leans to: more than half its codes. */
export function leaning(mix: EvidenceMix): EvidenceKind | null {
  for (const k of EVIDENCE_KINDS) if (mix.kinds[k.key] * 2 > mix.total) return k.key;
  return null;
}

/** The chord diagram's weights: `m[a][b]` is how many of theme a's codes
 *  sit in interviews that also hold theme b. Not symmetric — each end of a
 *  ribbon is sized by its own theme's codes. */
export function chordMatrix(rows: ThemeRow[]): number[][] {
  return rows.map((a, i) =>
    rows.map((b, j) => {
      if (i === j) return 0;
      let n = 0;
      for (const [id, codes] of a.counts) if (b.counts.has(id)) n += codes;
      return n;
    }),
  );
}

export type ChordArc = { index: number; start: number; end: number; value: number; isolated: boolean };
export type ChordRibbon = { source: { index: number; start: number; end: number }; target: { index: number; start: number; end: number }; values: [number, number] };

/** Angles (radians, clockwise from 12 o'clock) for a chord diagram. Each
 *  theme's arc is its row total; a theme that shares no interview with
 *  another still gets a small arc, so every theme is on the circle. Within
 *  an arc, each ribbon end takes its share in the order of the other
 *  themes. */
export function chordLayout(m: number[][], pad = 0.04, isolatedShare = 0.03): { arcs: ChordArc[]; ribbons: ChordRibbon[] } {
  const n = m.length;
  if (!n) return { arcs: [], ribbons: [] };
  const totals = m.map((r) => r.reduce((a, b) => a + b, 0));
  const sum = totals.reduce((a, b) => a + b, 0);
  const free = 2 * Math.PI - pad * n;
  // Isolated themes take a fixed share; the rest divide what remains.
  const isolated = totals.filter((t) => !t).length;
  const small = sum ? isolatedShare : 1 / n;
  const room = free * (1 - small * isolated);
  const arcs: ChordArc[] = [];
  const at: number[][] = [];
  let angle = 0;
  totals.forEach((t, i) => {
    const span = t ? (room * t) / sum : free * small;
    const arc = { index: i, start: angle, end: angle + span, value: t, isolated: !t };
    arcs.push(arc);
    const k = t ? span / t : 0;
    let cursor = angle;
    at.push(m[i].map((v) => {
      const s = cursor;
      cursor += v * k;
      return s;
    }));
    angle += span + pad;
  });
  const ribbons: ChordRibbon[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (!m[i][j] && !m[j][i]) continue;
      const ki = totals[i] ? (arcs[i].end - arcs[i].start) / totals[i] : 0;
      const kj = totals[j] ? (arcs[j].end - arcs[j].start) / totals[j] : 0;
      ribbons.push({
        source: { index: i, start: at[i][j], end: at[i][j] + m[i][j] * ki },
        target: { index: j, start: at[j][i], end: at[j][i] + m[j][i] * kj },
        values: [m[i][j], m[j][i]],
      });
    }
  return { arcs, ribbons };
}
