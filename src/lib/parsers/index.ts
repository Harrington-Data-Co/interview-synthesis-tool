import { parseCues } from "./cues";
import { docxToHtml, parseMeetHtml } from "./docx";
import { parsePlain } from "./plain";
import { TranscriptParseError, type ParsedTranscript } from "./types";

export { guessFromFilename } from "./filename";
export { TranscriptParseError } from "./types";
export type { Line, ParsedTranscript, TranscriptLayout } from "./types";

export const ACCEPTED_EXTENSIONS = [".vtt", ".srt", ".docx", ".txt", ".md"] as const;

/** Turn an uploaded (or pasted, saved as .txt) transcript into numbered
 *  speaker turns. Throws TranscriptParseError when nothing usable comes out,
 *  so an unreadable file is refused rather than stored as an empty record. */
export async function parseTranscript(
  fileName: string,
  bytes: Uint8Array,
): Promise<ParsedTranscript> {
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";

  let parsed: ParsedTranscript;
  if (ext === ".docx") {
    parsed = parseMeetHtml(await docxToHtml(bytes));
  } else if (ext === ".vtt" || ext === ".srt" || ext === ".txt" || ext === ".md") {
    const text = new TextDecoder("utf-8").decode(bytes);
    if (ext === ".vtt" || /^﻿?WEBVTT/.test(text)) parsed = parseCues(text, "vtt");
    else if (ext === ".srt") parsed = parseCues(text, "srt");
    else parsed = parsePlain(text);
  } else {
    throw new TranscriptParseError(
      `Can't read ${ext || "files without an extension"}. Upload ${ACCEPTED_EXTENSIONS.join(", ")}, or paste the transcript text.`,
    );
  }

  if (!parsed.lines.length) {
    throw new TranscriptParseError(
      "No speaker turns found in this file. If it's a meeting summary rather than a transcript, export the transcript instead.",
    );
  }
  return parsed;
}
