import type { Line, Segment } from "./types";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

/** Decode HTML character references. Teams writes "Thère" as "Th&#232;re". */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** Collapse runs of whitespace (including wrapped lines inside one cue) to a
 *  single space. Words are never altered — "…" and "uh" stay as spoken. */
export function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** "hh:mm:ss", "mm:ss", with optional ".mmm" or ",mmm" → seconds. */
export function parseClock(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return (
    (h ? Number(h) * 3600 : 0) +
    Number(min) * 60 +
    Number(sec) +
    (frac ? Number(frac.padEnd(3, "0")) / 1000 : 0)
  );
}

/** Merge consecutive segments from the same speaker into whole turns, and
 *  number them from 1. The turn keeps the first segment's start and the last
 *  segment's end. Empty segments are dropped. */
export function mergeTurns(segments: Segment[]): Line[] {
  const lines: Line[] = [];
  for (const seg of segments) {
    const text = squash(seg.text);
    const speaker = squash(seg.speaker) || "Unknown";
    if (!text) continue;

    const prev = lines.at(-1);
    if (prev && prev.speaker === speaker) {
      prev.text = `${prev.text} ${text}`;
      prev.tsStart ??= seg.tsStart;
      prev.tsEnd = seg.tsEnd ?? prev.tsEnd;
    } else {
      lines.push({ n: lines.length + 1, speaker, text, tsStart: seg.tsStart, tsEnd: seg.tsEnd });
    }
  }
  return lines;
}

/** Speakers in order of first appearance. */
export function speakersOf(lines: Line[]): string[] {
  return [...new Set(lines.map((l) => l.speaker))];
}

/** Split "Name: text". With a list of known names, the longest name that
 *  prefixes the line wins, so a display name containing a colon ("Jen :)")
 *  still splits correctly. Without one, the first ": " decides, and only when
 *  the prefix is short enough to be a name rather than a sentence. */
export function splitSpeaker(
  line: string,
  known: string[] = [],
): { speaker: string; text: string } | null {
  const byLength = [...known].sort((a, b) => b.length - a.length);
  for (const name of byLength) {
    if (line.startsWith(name + ":")) {
      return { speaker: name, text: line.slice(name.length + 1) };
    }
  }
  const m = line.match(/^([^:\n]{1,60}?):\s+([\s\S]*)$/);
  if (!m) return null;
  const speaker = m[1].trim();
  // A name is a few words; a sentence with a colon in it is not.
  if (speaker.split(/\s+/).length > 5 || /[.!?]$/.test(speaker)) return null;
  return { speaker, text: m[2] };
}
