import { decodeEntities, mergeTurns, parseClock, speakersOf, splitSpeaker } from "./text";
import type { ParsedTranscript, Segment } from "./types";

const TIMING = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

/** WebVTT (Teams, Zoom) and SRT: blocks of timing line + text, separated by
 *  blank lines. The speaker comes from a <v Name> voice tag (Teams) or a
 *  "Name: " prefix (Zoom, most SRT). */
export function parseCues(source: string, layout: "vtt" | "srt"): ParsedTranscript {
  const blocks = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const segments: Segment[] = [];
  let lastEnd: number | null = null;

  for (const block of blocks) {
    const rows = block.split("\n");
    const t = rows.findIndex((r) => TIMING.test(r));
    if (t === -1) continue; // header, NOTE, STYLE, stray numbering

    const [, a, b] = rows[t].match(TIMING)!;
    const tsStart = parseClock(a);
    const tsEnd = parseClock(b);
    if (tsEnd !== null) lastEnd = Math.max(lastEnd ?? 0, tsEnd);

    const raw = rows.slice(t + 1).join(" ");
    const voice = raw.match(/<v(?:\.[^\s>]+)*\s+([^>]+)>/);
    const text = decodeEntities(raw.replace(/<[^>]+>/g, ""));

    if (voice) {
      segments.push({ speaker: decodeEntities(voice[1]), text, tsStart, tsEnd });
    } else {
      const split = splitSpeaker(text.trim());
      segments.push({
        speaker: split?.speaker ?? "Unknown",
        text: split?.text ?? text,
        tsStart,
        tsEnd,
      });
    }
  }

  const lines = mergeTurns(segments);
  return { layout, lines, speakers: speakersOf(lines), durationSecs: lastEnd };
}
