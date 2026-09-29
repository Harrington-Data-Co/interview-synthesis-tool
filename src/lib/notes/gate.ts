import type { NoteCode, NoteSection } from "./prompt";

/** What Claude returns for one item, keyed the way the prompt names things. */
export type ItemProposal = { section: string; text: string; refs: string[] };

/** A proposal resolved to ids, ready for save_note_run(). */
export type ItemRow = { section_id: string; text: string; code_ids: string[] };

export type ItemRejection = { proposal: ItemProposal; reason: string };

/** Resolve Claude's section keys (S1…) and code refs (PAIN-03…) to ids, and
 *  apply the citation rules the database will apply again: real codes of this
 *  interview only, at least one per item, and — for Claude — only the types
 *  the section takes. The database has the final word on save. */
export function gateItems(
  proposals: ItemProposal[],
  sections: NoteSection[],
  codes: NoteCode[],
): { accepted: ItemRow[]; rejected: ItemRejection[] } {
  const byKey = new Map(sections.map((s, i) => [`S${i + 1}`, s]));
  const byName = new Map(sections.map((s) => [s.name.trim().toLowerCase(), s]));
  // "S2", "S2. Pain points", "S2 — Pain points", or the section's name.
  const sectionFor = (label: string) => {
    const t = label.trim();
    const key = t.match(/^S(\d+)\b/i);
    return key ? byKey.get(`S${Number(key[1])}`) : byName.get(t.toLowerCase());
  };
  const byRef = new Map(codes.map((c) => [c.ref.toUpperCase(), c]));
  const accepted: ItemRow[] = [];
  const rejected: ItemRejection[] = [];

  for (const p of proposals) {
    const reject = (reason: string) => rejected.push({ proposal: p, reason });
    const section = sectionFor(p.section);
    const text = p.text.replace(/\s+/g, " ").trim();
    const refs = [...new Set(p.refs.map((r) => r.trim().toUpperCase()))];
    const unknown = refs.filter((r) => !byRef.has(r));
    const cited = refs.map((r) => byRef.get(r)).filter((c): c is NoteCode => !!c);
    const offType = section?.requires.length ? cited.filter((c) => !section.requires.includes(c.type)) : [];

    if (!section) reject(`"${p.section}" isn't one of the template's sections.`);
    else if (!text) reject("The item has no text.");
    else if (!refs.length) reject("The item cites no codes.");
    else if (unknown.length) reject(`${unknown.join(", ")} ${unknown.length === 1 ? "isn't a code" : "aren't codes"} in this interview.`);
    else if (offType.length)
      reject(
        `${section.name} takes ${section.requires.join(", ")} codes; ${offType.map((c) => `${c.ref} is a ${c.type}`).join(", ")}.`,
      );
    else accepted.push({ section_id: section.id, text, code_ids: cited.map((c) => c.id) });
  }
  return { accepted, rejected };
}
