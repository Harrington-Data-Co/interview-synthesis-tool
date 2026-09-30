import { SOURCES, SPEAKER_ROLES, type SourceKind, type SpeakerRole } from "./preview";
import { ApiError } from "@/lib/api";

export type CommitFields = {
  expectedSha256: string;
  title: string;
  recordedOn: string | null;
  source: SourceKind;
  projectId: string | null;
  speakers: SpeakerChoice[];
};

/** One speaker as ingest_transcript() takes it: who they are (person_id, or
 *  new_person to create one by name, or neither), their part in the call,
 *  and their organization and title at the time. */
export type SpeakerChoice = {
  name: string;
  role: SpeakerRole;
  person_id: string | null;
  new_person: string | null;
  organization_id: string | null;
  title: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(form: FormData, key: string, max: number): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length > max) throw new ApiError(`${key} is too long.`);
  return t || null;
}

/** The uploader's confirmed details, validated. Everything from the form is
 *  untrusted; the lines themselves are never taken from it at all. */
export function readCommitFields(form: FormData): CommitFields {
  const expectedSha256 = text(form, "sha256", 64) ?? "";
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new ApiError("Missing the previewed file's checksum.");

  const title = text(form, "title", 200);
  if (!title) throw new ApiError("Give the transcript a title.");

  const recordedOn = text(form, "recordedOn", 10);
  if (recordedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(recordedOn) || Number.isNaN(Date.parse(recordedOn)))) {
    throw new ApiError("Recorded on must be a date.");
  }

  const source = text(form, "source", 20) ?? "upload";
  if (!(SOURCES as readonly string[]).includes(source)) throw new ApiError("Unknown source.");

  const projectId = text(form, "projectId", 36);
  if (projectId && !UUID.test(projectId)) throw new ApiError("Unknown project.");

  const speakers: SpeakerChoice[] = [];
  const rawSpeakers = text(form, "speakers", 50_000);
  if (rawSpeakers) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawSpeakers);
    } catch {
      throw new ApiError("Speaker details are malformed.");
    }
    if (!Array.isArray(parsed)) throw new ApiError("Speaker details are malformed.");
    for (const s of parsed as Record<string, unknown>[]) {
      if (!s || typeof s.name !== "string") continue;
      const role = typeof s.role === "string" && (SPEAKER_ROLES as readonly string[]).includes(s.role)
        ? (s.role as SpeakerRole)
        : "other";
      const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "") || null;
      const personId = typeof s.personId === "string" && UUID.test(s.personId) ? s.personId : null;
      const org = typeof s.organizationId === "string" && UUID.test(s.organizationId) ? s.organizationId : null;
      speakers.push({
        name: s.name,
        role,
        person_id: personId,
        new_person: personId ? null : str(s.newPerson),
        organization_id: org,
        title: str(s.title),
      });
    }
  }

  return {
    expectedSha256,
    title,
    recordedOn,
    source: source as SourceKind,
    projectId,
    speakers,
  };
}
