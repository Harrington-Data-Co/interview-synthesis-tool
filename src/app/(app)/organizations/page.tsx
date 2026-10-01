import { PeopleHeader } from "@/components/people/PeopleHeader";
import { OrganizationsView, type OrgUsage } from "@/components/people/OrganizationsView";
import { loadDirectory } from "@/lib/directory";
import { redirect } from "next/navigation";
import { canEditWorkspace, currentSeat, isStaff } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Every organization, as a tree, with who's at each and which interviews
 *  they speak in: where organizations are renamed, moved, merged and
 *  deleted. */
export default async function OrganizationsPage() {
  const seat = await currentSeat();
  if (!isStaff(seat)) redirect("/");
  const supabase = await createClient();
  const [directory, { data: people, error }, { data: speakers }] = await Promise.all([
    loadDirectory(supabase),
    supabase.from("person").select("id,name,title,organization_id").not("organization_id", "is", null),
    supabase.from("transcript_speaker").select("organization_id,transcript:transcript_id(id,title,recorded_on,ingested_at)").not("organization_id", "is", null),
  ]);

  const usage: Record<string, OrgUsage> = {};
  const of = (id: string) => (usage[id] ??= { people: [], interviews: [] });
  for (const p of people ?? []) of(p.organization_id as string).people.push({ id: p.id, name: p.name, title: p.title });
  type Raw = { organization_id: string; transcript: { id: string; title: string; recorded_on: string | null; ingested_at: string } };
  for (const s of (speakers ?? []) as unknown as Raw[]) {
    const u = of(s.organization_id);
    if (!u.interviews.some((i) => i.id === s.transcript.id)) {
      u.interviews.push({ id: s.transcript.id, title: s.transcript.title, date: s.transcript.recorded_on ?? s.transcript.ingested_at.slice(0, 10) });
    }
  }

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-5, 20px)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <PeopleHeader
        tab="organizations"
        blurb={
          <>
            Who speakers are with, nested: an organization can hold sub-organizations (Delaware DOE › Office of Early Learning). Rename or move one here, merge duplicates, and
            delete what nothing uses.
          </>
        }
      />
      {error ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta" style={{ margin: 0 }}>
            Could not read organizations: {error.message}. Have the migrations in <code>supabase/migrations</code> been applied?
          </p>
        </div>
      ) : (
        <OrganizationsView organizations={directory.organizations} usage={usage} editor={canEditWorkspace(seat)} />
      )}
    </div>
  );
}
