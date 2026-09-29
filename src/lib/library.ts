import type { SupabaseClient } from "@supabase/supabase-js";

export type SpeakerRef = {
  name: string;
  display_name: string | null;
  organization_id: string | null;
  role: "interviewer" | "participant" | "other";
};

export type TranscriptRow = {
  id: string;
  title: string;
  participant: string | null;
  source: string;
  duration_mins: number | null;
  recorded_on: string | null;
  status: "new" | "queued" | "coded";
  project_id: string | null;
  speakers: SpeakerRef[];
};

const COLUMNS =
  "id,title,participant,source,duration_mins,recorded_on,status,project_id,speakers:transcript_speaker(name,display_name,organization_id,role)";

/** Transcripts with their speakers, newest recording first (undated last). */
export async function loadTranscripts(
  supabase: SupabaseClient,
  filter?: { projectId?: string | null },
): Promise<{ rows: TranscriptRow[]; error: string | null }> {
  let q = supabase.from("transcript").select(COLUMNS);
  if (filter?.projectId) q = q.eq("project_id", filter.projectId);
  if (filter?.projectId === null) q = q.is("project_id", null);
  const { data, error } = await q
    .order("recorded_on", { ascending: false, nullsFirst: false })
    .order("ingested_at", { ascending: false });
  return { rows: (data ?? []) as unknown as TranscriptRow[], error: error?.message ?? null };
}

/** Who was interviewed: the participant speakers' display names, falling back
 *  to the transcript's participant field. */
export function participantNames(t: TranscriptRow): string[] {
  const named = t.speakers.filter((s) => s.role === "participant").map((s) => s.display_name ?? s.name);
  return named.length ? named : t.participant ? [t.participant] : [];
}

export function participantsOf(t: TranscriptRow): string {
  return participantNames(t).join(", ") || "—";
}

export function participantOrgIds(t: TranscriptRow): string[] {
  return [
    ...new Set(
      t.speakers.filter((s) => s.role === "participant" && s.organization_id).map((s) => s.organization_id!),
    ),
  ];
}

export const SOURCE_LABEL: Record<string, string> = {
  meet: "Google Meet",
  wispr: "Wispr Flow",
  teams: "Teams",
  zoom: "Zoom",
  otter: "Otter.ai",
  granola: "Granola",
  upload: "Upload",
};
