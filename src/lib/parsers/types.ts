/** One piece of speech as a source file delivers it: a VTT cue, a docx
 *  paragraph, a line of pasted text. Several of these usually make one turn. */
export type Segment = {
  speaker: string;
  text: string;
  /** Seconds from the start of the recording, when the source says. */
  tsStart: number | null;
  tsEnd: number | null;
};

/** One transcript line: a whole speaker turn. This is what becomes an
 *  immutable transcript_line row, so `n` is its permanent address. */
export type Line = Segment & { n: number };

export type TranscriptLayout =
  | "vtt" // Teams, Zoom, any WebVTT
  | "srt"
  | "meet-gemini" // Google Meet "Notes by Gemini" doc: AI notes, then the transcript
  | "meet-transcript" // Google Meet transcript doc: attendees, then the transcript
  | "plain"; // "Name: text" lines — Wispr Flow, pasted text, anything else

export type ParsedTranscript = {
  layout: TranscriptLayout;
  lines: Line[];
  /** Everyone who speaks, in order of first appearance, as written. */
  speakers: string[];
  /** Best evidence of recording length: an explicit end marker, else the last
   *  timestamp seen. Null when the source carries no times at all. */
  durationSecs: number | null;
};

/** The file could be read but holds nothing usable as a transcript. */
export class TranscriptParseError extends Error {
  name = "TranscriptParseError";
}
