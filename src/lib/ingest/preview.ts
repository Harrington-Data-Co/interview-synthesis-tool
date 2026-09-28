import { guessFromFilename, type ParsedTranscript } from "@/lib/parsers";

export const SOURCES = ["meet", "wispr", "teams", "zoom", "otter", "granola", "upload"] as const;
export type SourceKind = (typeof SOURCES)[number];

export const SPEAKER_ROLES = ["interviewer", "participant", "other"] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

export type SpeakerPreview = {
  name: string;
  turns: number;
  words: number;
  /** The start of their first turn, so the uploader can tell who "Jen :)" is. */
  firstWords: string;
  role: SpeakerRole;
};

export type IngestPreview = {
  fileName: string;
  sha256: string;
  layout: ParsedTranscript["layout"];
  lineCount: number;
  durationMins: number | null;
  speakers: SpeakerPreview[];
  title: string;
  participant: string | null;
  recordedOn: string | null;
  source: SourceKind;
  duplicateOf: { id: string; title: string } | null;
};

const firstName = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

/** First names agree, ignoring punctuation: "Sierra" matches "Sierra Harris".
 *  Deliberately loose, and only a starting guess — "Jen :)" won't match
 *  "Jennifer", so the uploader sets that one. Every role is editable. */
function sameFirstName(a: string, b: string | null | undefined): boolean {
  if (!b) return false;
  const x = firstName(a).replace(/[^\p{L}]/gu, "");
  const y = firstName(b).replace(/[^\p{L}]/gu, "");
  return x.length > 1 && x === y;
}

function guessSource(layout: ParsedTranscript["layout"], pasted: boolean): SourceKind {
  if (layout === "meet-gemini" || layout === "meet-transcript") return "meet";
  if (layout === "vtt") return "teams"; // the VTTs that actually arrive are Teams'
  if (pasted) return "wispr"; // Wispr Flow has no file export, only copy-paste
  return "upload";
}

export function buildPreview(args: {
  parsed: ParsedTranscript;
  fileName: string;
  sha256: string;
  pasted: boolean;
  uploaderName: string;
  duplicateOf: { id: string; title: string } | null;
}): IngestPreview {
  const { parsed, fileName, sha256, pasted, uploaderName, duplicateOf } = args;
  const guess = guessFromFilename(fileName);

  const speakers = parsed.speakers.map((name): SpeakerPreview => {
    const theirs = parsed.lines.filter((l) => l.speaker === name);
    const role: SpeakerRole = sameFirstName(name, guess.participant)
      ? "participant"
      : sameFirstName(name, uploaderName)
        ? "interviewer"
        : "other";
    return {
      name,
      turns: theirs.length,
      words: theirs.reduce((sum, l) => sum + l.text.split(/\s+/).length, 0),
      firstWords: theirs[0]?.text.slice(0, 90) ?? "",
      role,
    };
  });

  return {
    fileName,
    sha256,
    layout: parsed.layout,
    lineCount: parsed.lines.length,
    durationMins: parsed.durationSecs === null ? null : Math.max(1, Math.round(parsed.durationSecs / 60)),
    speakers,
    title: guess.title,
    participant: guess.participant,
    recordedOn: guess.recordedOn,
    source: guessSource(parsed.layout, pasted),
    duplicateOf,
  };
}
