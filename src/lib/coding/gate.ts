import { CLAUDE_CODE_TYPES, type ClaudeCodeType, type CodingLine } from "./prompt";

export type Proposal = {
  line_start: number;
  line_end: number;
  type: ClaudeCodeType;
  label: string;
  verbatim: string;
  note: string;
};

export type Rejection = { proposal: Proposal; reason: string };

/** Whether `quote` appears in lines start..end (joined by single spaces),
 *  starting within the first line and ending within the last — the same rule
 *  as the database's check_code_anchor(). */
export function quoteFits(lines: Map<number, CodingLine>, start: number, end: number, quote: string): boolean {
  const range: string[] = [];
  for (let n = start; n <= end; n++) {
    const l = lines.get(n);
    if (!l) return false;
    range.push(l.text);
  }
  const text = range.join(" ");
  const first = range[0].length;
  const last = range[range.length - 1].length;
  for (let from = 0; ; ) {
    const at = text.indexOf(quote, from);
    if (at === -1) return false;
    // 0-based: starts within the first line, ends within the last.
    if (at < first && at + quote.length > text.length - last) return true;
    from = at + 1;
  }
}

/** The app's copy of the database's checks, run before saving so a pass can
 *  report what it will keep, plus the shape checks the database can't make
 *  (a line that doesn't exist, a type Claude isn't allowed). The database
 *  checks again on insert and has the final word. */
export function gate(proposals: Proposal[], lines: CodingLine[]): { accepted: Proposal[]; rejected: Rejection[] } {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const seen = new Set<string>();
  const accepted: Proposal[] = [];
  const rejected: Rejection[] = [];

  for (const raw of proposals) {
    // Whitespace is the one thing normalised: lines are stored single-spaced.
    const p = { ...raw, verbatim: raw.verbatim.replace(/\s+/g, " ").trim(), label: raw.label.trim(), note: raw.note.trim() };
    const reject = (reason: string) => rejected.push({ proposal: p, reason });

    if (!Number.isInteger(p.line_start) || !Number.isInteger(p.line_end) || p.line_start > p.line_end) {
      reject(`Invalid line range L${p.line_start}–L${p.line_end}.`);
    } else if (!byN.has(p.line_start) || !byN.has(p.line_end)) {
      reject(`Line L${!byN.has(p.line_start) ? p.line_start : p.line_end} doesn't exist.`);
    } else if (!(CLAUDE_CODE_TYPES as readonly string[]).includes(p.type)) {
      reject(`"${p.type}" isn't a code type Claude may use.`);
    } else if (!p.verbatim || !p.label) {
      reject("Missing its quote or label.");
    } else if (!quoteFits(byN, p.line_start, p.line_end, p.verbatim)) {
      reject(`The quote isn't word for word in lines ${p.line_start}–${p.line_end}, or the range is wider than the quote.`);
    } else if (
      Array.from({ length: p.line_end - p.line_start + 1 }, (_, i) => byN.get(p.line_start + i)!).some(
        (l) => l.role === "interviewer",
      )
    ) {
      reject(`Claude's codes may only quote participants; lines ${p.line_start}–${p.line_end} include an interviewer.`);
    } else {
      const key = `${p.type}|${p.line_start}|${p.line_end}|${p.verbatim}`;
      if (seen.has(key)) continue; // a duplicate (e.g. from overlapping chunks): drop quietly
      seen.add(key);
      accepted.push(p);
    }
  }
  return { accepted, rejected };
}
