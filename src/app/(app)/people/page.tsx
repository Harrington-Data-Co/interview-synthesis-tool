import { PeopleHeader } from "@/components/people/PeopleHeader";
import { PeopleView } from "@/components/people/PeopleView";
import type { PersonInterview, PersonRow } from "@/components/people/view";
import { loadDirectory } from "@/lib/directory";
import { redirect } from "next/navigation";
import { canEditWorkspace, currentSeat, isStaff } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Everyone who speaks in an interview, with their current organization and
 *  title and the interviews they're in: where people are fixed up and
 *  duplicates merged. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const { person: openPersonId } = await searchParams;
  const seat = await currentSeat();
  if (!isStaff(seat)) redirect("/");
  const supabase = await createClient();
  const [directory, { data, error }] = await Promise.all([
    loadDirectory(supabase),
    supabase
      .from("person")
      .select(
        "id,name,organization_id,title," + "speakers:transcript_speaker(name,role,title,organization_id,transcript:transcript_id(id,title,recorded_on,ingested_at,project_id))",
      )
      .order("name"),
  ]);

  type Raw = {
    id: string;
    name: string;
    organization_id: string | null;
    title: string | null;
    speakers: {
      name: string;
      role: string;
      title: string | null;
      organization_id: string | null;
      transcript: { id: string; title: string; recorded_on: string | null; ingested_at: string; project_id: string | null };
    }[];
  };
  const projectOf = new Map(directory.projects.map((p) => [p.id, p]));
  const clientName = new Map(directory.clients.map((c) => [c.id, c.name]));
  const people: PersonRow[] = ((data ?? []) as unknown as Raw[]).map((p) => {
    // One entry per interview, however many names they had in it.
    const byTranscript = new Map<string, PersonInterview>();
    for (const s of p.speakers) {
      const had = byTranscript.get(s.transcript.id);
      const project = s.transcript.project_id ? projectOf.get(s.transcript.project_id) : undefined;
      byTranscript.set(s.transcript.id, {
        id: s.transcript.id,
        title: s.transcript.title,
        date: s.transcript.recorded_on ?? s.transcript.ingested_at.slice(0, 10),
        role: had?.role === "participant" ? had.role : s.role,
        titleThen: had?.titleThen ?? s.title,
        orgThen: had?.orgThen ?? s.organization_id,
        names: [...(had?.names ?? []), s.name],
        project: project?.name ?? null,
        client: project ? (clientName.get(project.clientId) ?? null) : null,
      });
    }
    return {
      id: p.id,
      name: p.name,
      organizationId: p.organization_id,
      title: p.title,
      interviews: [...byTranscript.values()].sort((a, b) => b.date.localeCompare(a.date)),
    };
  });

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-5, 20px)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <PeopleHeader
        tab="people"
        blurb={
          <>
            Everyone who speaks in a transcript, interviewers included. Organization and title are their latest, and the next upload pre-fills them; each interview keeps what was
            true at the time. Merge duplicates here.
          </>
        }
      />
      {error ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta" style={{ margin: 0 }}>
            Could not read people: {error.message}. Has <code>supabase/migrations/20260930a_people.sql</code> been applied?
          </p>
        </div>
      ) : (
        <PeopleView people={people} organizations={directory.organizations} editor={canEditWorkspace(seat)} initialOpenId={openPersonId} />
      )}
    </div>
  );
}
