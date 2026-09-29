import type { ThemeCode } from "./prompt";

export type ThemeProposal = { title: string; description: string; codes: string[] };
export type ThemeRow = { title: string; description: string; code_ids: string[] };
export type ThemeRejection = { proposal: ThemeProposal; reason: string };

/** Resolve Claude's code keys (I3:PAIN-03) to ids. A theme keeps whichever
 *  of its codes are real; keys that aren't are recorded for review rather
 *  than silently dropped. A theme left with no real codes, or no title, is
 *  rejected. The database checks membership again on save. */
export function gateThemes(
  proposals: ThemeProposal[],
  codes: ThemeCode[],
): { accepted: ThemeRow[]; rejected: ThemeRejection[] } {
  const byKey = new Map(codes.map((c) => [c.key.toUpperCase().replace(/\s+/g, ""), c]));
  const accepted: ThemeRow[] = [];
  const rejected: ThemeRejection[] = [];

  for (const p of proposals) {
    const title = p.title.replace(/\s+/g, " ").trim();
    const keys = [...new Set(p.codes.map((k) => k.toUpperCase().replace(/\s+/g, "")))];
    const found = keys.map((k) => byKey.get(k)).filter((c): c is ThemeCode => !!c);
    const unknown = keys.filter((k) => !byKey.has(k));

    if (!title) {
      rejected.push({ proposal: p, reason: "The theme has no title." });
    } else if (!found.length) {
      rejected.push({ proposal: p, reason: "None of the theme's codes are codes in this project." });
    } else {
      accepted.push({ title, description: p.description.replace(/\s+/g, " ").trim(), code_ids: found.map((c) => c.id) });
      if (unknown.length) {
        rejected.push({
          proposal: { ...p, codes: unknown },
          reason: `"${title}" was kept, but ${unknown.join(", ")} ${unknown.length === 1 ? "isn't a code" : "aren't codes"} in this project, so ${unknown.length === 1 ? "it was" : "they were"} left out.`,
        });
      }
    }
  }
  return { accepted, rejected };
}
