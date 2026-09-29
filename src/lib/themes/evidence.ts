import type { SupabaseClient } from "@supabase/supabase-js";
import { withPaths } from "@/lib/directory";

export type EvidenceInterview = {
  id: string;
  key: string; // I1, I2… in recording order
  title: string;
  participant: string | null;
  organization: string | null;
  codeCount: number;
};

export type EvidenceCode = {
  id: string;
  key: string; // I3:PAIN-03
  transcriptId: string;
  ref: string;
  type: string;
  label: string;
  verbatim: string;
  line_start: number;
  line_end: number;
};

/** A project's coded interviews, keyed I1… in recording order, and their
 *  active codes keyed I3:PAIN-03 — the evidence themes and the memo cite.
 *  Keys are stable while the set of coded interviews doesn't change. */
export async function loadProjectEvidence(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ interviews: EvidenceInterview[]; codes: EvidenceCode[] }> {
  const [{ data: ts }, { data: orgs }] = await Promise.all([
    supabase
      .from("transcript")
      .select("id,title,participant,recorded_on,speakers:transcript_speaker(name,display_name,role,organization_id)")
      .eq("project_id", projectId)
      .order("recorded_on", { ascending: true, nullsFirst: false })
      .order("title"),
    supabase.from("organization").select("id,name,parent_id"),
  ]);
  const orgPath = new Map(withPaths(orgs ?? []).map((o) => [o.id, o.path]));
  const ids = (ts ?? []).map((t) => t.id);

  const codes: EvidenceCode[] = [];
  if (ids.length) {
    // Paged: a large project can pass PostgREST's 1000-row cap.
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("code")
        .select("id,transcript_id,ref,type,label,verbatim,line_start,line_end")
        .in("transcript_id", ids)
        .is("merged_into_id", null)
        .order("transcript_id")
        .order("line_start")
        .range(from, from + 999);
      for (const c of data ?? []) {
        codes.push({ ...c, transcriptId: c.transcript_id, key: "" });
      }
      if (!data || data.length < 1000) break;
    }
  }

  const coded = (ts ?? []).filter((t) => codes.some((c) => c.transcriptId === t.id));
  const interviews: EvidenceInterview[] = coded.map((t, i) => {
    const participants = (t.speakers ?? []).filter((s: { role: string }) => s.role === "participant");
    const org = participants.map((s: { organization_id: string | null }) => s.organization_id && orgPath.get(s.organization_id)).find(Boolean);
    return {
      id: t.id,
      key: `I${i + 1}`,
      title: t.title,
      participant:
        participants.map((s: { name: string; display_name: string | null }) => s.display_name ?? s.name).join(", ") ||
        t.participant,
      organization: org || null,
      codeCount: codes.filter((c) => c.transcriptId === t.id).length,
    };
  });
  const keyOf = new Map(interviews.map((i) => [i.id, i.key]));
  for (const c of codes) c.key = `${keyOf.get(c.transcriptId)}:${c.ref}`;
  return { interviews, codes: codes.filter((c) => keyOf.has(c.transcriptId)) };
}
