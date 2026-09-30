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
  /** Who they are: someone known, or a new person to create by name. At
   *  most one is set; neither means not identified ("Unknown"). */
  personId: string | null;
  newPerson: string | null;
  /** The person's current organization and title, else what this export
   *  name last had. */
  organizationId: string | null;
  title: string | null;
};

/** What was last recorded for a speaker name, so people seen before (Ryan,
 *  "Jen :)" → Jennifer Koester) come pre-filled. */
export type KnownSpeaker = {
  personId: string | null;
  displayName: string | null;
  organizationId: string | null;
  title: string | null;
  role: SpeakerRole;
};

/** A known person, as the preview matches names against them. */
export type KnownPerson = { id: string; name: string; organizationId: string | null; title: string | null };

/** Exports' placeholder names, never matched to or made into a person.
 *  Mirrors is_generic_speaker() in the database. */
export function isGenericSpeaker(name: string): boolean {
  return /^(unknown( speaker)?|speaker ?[0-9]*|participant ?[0-9]*|interviewer ?[0-9]*|guest ?[0-9]*|user ?[0-9]*|[0-9]+|\?+)$/i.test(name.trim());
}

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
  known?: Record<string, KnownSpeaker>;
  people?: KnownPerson[];
}): IngestPreview {
  const { parsed, fileName, sha256, pasted, uploaderName, duplicateOf, known = {}, people = [] } = args;
  const byName = new Map<string, KnownPerson[]>();
  for (const p of people) byName.set(p.name.trim().toLowerCase(), [...(byName.get(p.name.trim().toLowerCase()) ?? []), p]);
  const personOf = new Map(people.map((p) => [p.id, p]));
  const guess = guessFromFilename(fileName);

  // Who a speaker is: the person this export name was last, else the one
  // person with this name, else a new person (named from the file name when
  // the first names agree: "Dana" in "Dana Reyes.docx"). Their current
  // organization and title come along; placeholders stay unidentified.
  const who = (name: string, seen: KnownSpeaker | undefined, role: SpeakerRole) => {
    const lastTime = seen?.personId ? personOf.get(seen.personId) : undefined;
    const matches = byName.get(name.trim().toLowerCase()) ?? byName.get((seen?.displayName ?? "").trim().toLowerCase()) ?? [];
    const person = lastTime ?? (matches.length === 1 ? matches[0] : undefined);
    if (person) {
      return {
        personId: person.id,
        newPerson: null,
        organizationId: person.organizationId ?? seen?.organizationId ?? null,
        title: person.title ?? seen?.title ?? null,
      };
    }
    const fromFile = role === "participant" && guess.participant && guess.participant.length > name.length ? guess.participant : null;
    return {
      personId: null,
      newPerson: isGenericSpeaker(name) ? null : (fromFile ?? seen?.displayName ?? name),
      organizationId: seen?.organizationId ?? null,
      title: seen?.title ?? null,
    };
  };

  const speakers = parsed.speakers.map((name): SpeakerPreview => {
    const theirs = parsed.lines.filter((l) => l.speaker === name);
    const seen = known[name];
    // Participants change from interview to interview; interviewers don't.
    const role: SpeakerRole = sameFirstName(name, guess.participant)
      ? "participant"
      : sameFirstName(name, uploaderName) || seen?.role === "interviewer"
        ? "interviewer"
        : "other";
    return {
      name,
      turns: theirs.length,
      words: theirs.reduce((sum, l) => sum + l.text.split(/\s+/).length, 0),
      firstWords: theirs[0]?.text.slice(0, 90) ?? "",
      role,
      ...who(name, seen, role),
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
