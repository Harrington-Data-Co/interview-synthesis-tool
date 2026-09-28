import { SOURCES, SPEAKER_ROLES, type SourceKind, type SpeakerRole } from "./preview";
import { ApiError } from "@/lib/api";

export type CommitFields = {
  expectedSha256: string;
  title: string;
  participant: string | null;
  participantRole: string | null;
  recordedOn: string | null;
  source: SourceKind;
  projectId: string | null;
  roles: Record<string, SpeakerRole>;
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

  let roles: Record<string, SpeakerRole> = {};
  const rawRoles = text(form, "roles", 20_000);
  if (rawRoles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawRoles);
    } catch {
      throw new ApiError("Speaker roles are malformed.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError("Speaker roles are malformed.");
    }
    roles = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, SpeakerRole] =>
          typeof e[1] === "string" && (SPEAKER_ROLES as readonly string[]).includes(e[1]),
      ),
    );
  }

  return {
    expectedSha256,
    title,
    participant: text(form, "participant", 200),
    participantRole: text(form, "participantRole", 200),
    recordedOn,
    source: source as SourceKind,
    projectId,
    roles,
  };
}
