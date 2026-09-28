import { parseClock, splitSpeaker, squash } from "./text";
import type { Segment } from "./types";

/** One paragraph (docx) or line (text) of a transcript body. `boldName` is set
 *  when the source marks the speaker with formatting, which is more reliable
 *  than splitting on a colon. */
export type Row = { text: string; boldName?: string; boldRest?: string };

const TIME_MARKER = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const ENDED = /^Transcription ended after (\d{1,2}:\d{2}(?::\d{2})?)/i;
const FOOTER = /^This editable transcript was computer generated/i;

/** Walk transcript rows into segments. Shared by every layout whose body is
 *  "speaker: text" rows with optional time markers between them.
 *
 *  - A time marker row stamps the next segment's start. Meet drops one roughly
 *    every minute, so a turn's start is approximate, never invented.
 *  - A row with no speaker continues the previous speaker's turn. Before the
 *    first speaker it is preamble (a date, a title) and is skipped.
 *  - Meet's "Transcription ended" marker and its footer end the body. */
export function walkRows(
  rows: Row[],
  known: string[] = [],
): { segments: Segment[]; durationSecs: number | null } {
  const segments: Segment[] = [];
  const names = new Set(known);
  let pendingStart: number | null = null;
  let lastMarker: number | null = null;
  let ended: number | null = null;

  for (const row of rows) {
    const text = squash(row.text);
    if (!text) continue;

    const endMatch = text.match(ENDED);
    if (endMatch) {
      ended = parseClock(endMatch[1]);
      break;
    }
    if (FOOTER.test(text)) break;

    if (TIME_MARKER.test(text)) {
      pendingStart = parseClock(text);
      lastMarker = pendingStart;
      continue;
    }

    let speaker: string | undefined;
    let said: string | undefined;
    if (row.boldName !== undefined) {
      speaker = row.boldName;
      said = row.boldRest ?? "";
    } else {
      const split = splitSpeaker(text, [...names]);
      if (split) ({ speaker, text: said } = split);
    }

    if (speaker !== undefined && said !== undefined) {
      names.add(speaker);
      segments.push({ speaker, text: said, tsStart: pendingStart, tsEnd: null });
      pendingStart = null;
    } else if (segments.length) {
      segments.at(-1)!.text += ` ${text}`;
    }
  }

  return { segments, durationSecs: ended ?? lastMarker };
}
