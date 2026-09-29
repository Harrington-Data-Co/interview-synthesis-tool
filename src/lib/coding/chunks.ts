import type { CodingLine } from "./prompt";

/** Roughly 40k tokens of transcript. A 60-minute interview is about a third
 *  of that, so real interviews go in one call; this only matters for very
 *  long ones. Never truncated — split. */
export const CHUNK_CHARS = 160_000;
/** Lines repeated from the previous chunk, so a point that spans the seam
 *  has its context. */
export const OVERLAP_LINES = 12;

export type Chunk = { lines: CodingLine[]; codeFrom: number };

const size = (l: CodingLine) => l.text.length + l.speaker.length + 16;

/** Split into chunks under `limit` characters. Each chunk after the first
 *  starts with the previous chunk's last OVERLAP_LINES lines as context;
 *  `codeFrom` is the first line that chunk is responsible for. */
export function chunkLines(lines: CodingLine[], limit = CHUNK_CHARS, overlap = OVERLAP_LINES): Chunk[] {
  const total = lines.reduce((s, l) => s + size(l), 0);
  if (total <= limit || lines.length === 0) return [{ lines, codeFrom: lines[0]?.n ?? 1 }];

  const chunks: Chunk[] = [];
  let start = 0; // index of the first line this chunk codes
  while (start < lines.length) {
    const ctxStart = Math.max(0, start - (chunks.length ? overlap : 0));
    let used = lines.slice(ctxStart, start).reduce((s, l) => s + size(l), 0);
    let end = start;
    // Always take at least one new line, so a single huge line can't stall.
    do {
      used += size(lines[end]);
      end++;
    } while (end < lines.length && used + size(lines[end]) <= limit);
    chunks.push({ lines: lines.slice(ctxStart, end), codeFrom: lines[start].n });
    start = end;
  }
  return chunks;
}
