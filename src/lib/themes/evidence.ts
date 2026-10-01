import type { SupabaseClient } from "@supabase/supabase-js";
import { withPaths } from "@/lib/directory";

export type EvidenceInterview = {
  id: string;
  key: string; // I1, I2… in recording order
  title: string;
  participant: string | null;
  organization: string | null;
  /** The same organization, by id (for grouping by kind). */
  organizationId: string | null;
  /** The participants' titles at the time ("Program officer, Controller"). */
  role: string | null;
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
      .select("id,title,participant,recorded_on,speakers:transcript_speaker(name,display_name,role,organization_id,title)")
      .eq("project_id", projectId)
      .order("recorded_on", { ascending: true, nullsFirst: false })
      .order("title"),
    supabase.from("organization").select("id,name,parent_id"),
  ]);
  // A client on deliverables-only access can't read the transcripts; they
  // get the quotes they may see, keyed and titled, from client_evidence.
  if (!ts?.length) return clientEvidence(supabase, projectId);
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
    const orgId: string | null = participants.map((s: { organization_id: string | null }) => s.organization_id).find((id: string | null) => id && orgPath.has(id)) ?? null;
    const org = orgId ? orgPath.get(orgId) : null;
    return {
      id: t.id,
      key: `I${i + 1}`,
      title: t.title,
      participant:
        participants.map((s: { name: string; display_name: string | null }) => s.display_name ?? s.name).join(", ") ||
        t.participant,
      organization: org || null,
      organizationId: orgId,
      role: [...new Set(participants.map((s: { title: string | null }) => s.title).filter(Boolean))].join(", ") || null,
      codeCount: codes.filter((c) => c.transcriptId === t.id).length,
    };
  });
  const keyOf = new Map(interviews.map((i) => [i.id, i.key]));
  for (const c of codes) c.key = `${keyOf.get(c.transcriptId)}:${c.ref}`;
  return { interviews, codes: codes.filter((c) => keyOf.has(c.transcriptId)) };
}

type ClientEvidenceRow = {
  transcript_id: string;
  interview_key: string;
  titles: string | null;
  code_id: string;
  ref: string;
  type: string;
  label: string;
  verbatim: string;
  line_start: number;
  line_end: number;
};

/** The evidence a client may see: only cited quotes, attributed by title.
 *  Interviews keep the keys everyone else sees (I3), with no title or names. */
async function clientEvidence(supabase: SupabaseClient, projectId: string): Promise<{ interviews: EvidenceInterview[]; codes: EvidenceCode[] }> {
  const { data } = await supabase.rpc("client_evidence", { p_project_id: projectId });
  const rows = (data ?? []) as ClientEvidenceRow[];
  const interviews = new Map<string, EvidenceInterview>();
  const codes: EvidenceCode[] = [];
  for (const r of rows) {
    const i = interviews.get(r.transcript_id) ?? {
      id: r.transcript_id,
      key: r.interview_key,
      title: `Interview ${r.interview_key}`,
      participant: null,
      organization: null,
      organizationId: null,
      role: r.titles,
      codeCount: 0,
    };
    i.codeCount += 1;
    interviews.set(r.transcript_id, i);
    codes.push({
      id: r.code_id,
      key: `${r.interview_key}:${r.ref}`,
      transcriptId: r.transcript_id,
      ref: r.ref,
      type: r.type,
      label: r.label,
      verbatim: r.verbatim,
      line_start: r.line_start,
      line_end: r.line_end,
    });
  }
  return { interviews: [...interviews.values()], codes };
}
