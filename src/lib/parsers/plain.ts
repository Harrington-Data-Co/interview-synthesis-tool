import { mergeTurns, speakersOf } from "./text";
import type { ParsedTranscript } from "./types";
import { walkRows, type Row } from "./walk";

/** Pasted or .txt/.md transcripts: "Name: text" lines. This is Wispr Flow's
 *  shape, and the fallback for anything else. Markdown speaker labels
 *  ("**Name:** text") are honoured, and markdown headings are skipped. */
export function parsePlain(source: string): ParsedTranscript {
  const rows: Row[] = [];
  for (const line of source.replace(/^﻿/, "").split(/\r\n?|\n/)) {
    if (/^\s*#{1,6}\s/.test(line)) continue;
    const md = line.match(/^\s*\*\*(.+?)\*\*\s*(.*)$/);
    if (md) {
      const inner = md[1].trim();
      if (inner.endsWith(":")) {
        rows.push({ text: line, boldName: inner.slice(0, -1).trim(), boldRest: md[2] });
        continue;
      }
      if (md[2].startsWith(":")) {
        rows.push({ text: line, boldName: inner, boldRest: md[2].slice(1) });
        continue;
      }
    }
    rows.push({ text: line });
  }

  const { segments, durationSecs } = walkRows(rows);
  const lines = mergeTurns(segments);
  return { layout: "plain", lines, speakers: speakersOf(lines), durationSecs };
}
