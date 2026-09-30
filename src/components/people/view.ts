import { NONE, type Column } from "@/components/table/view";
import { topOf } from "@/lib/directory";

/** One interview a person is in, as the People page shows it. */
export type PersonInterview = {
  id: string;
  title: string;
  date: string;
  role: string;
  /** Their title and organization (id) at the time of that interview. */
  titleThen: string | null;
  orgThen: string | null;
  /** The names the export wrote for them ("Jen :)", "Jennifer Koester"). */
  names: string[];
  project: string | null;
  client: string | null;
};

export type PersonRow = {
  id: string;
  name: string;
  organizationId: string | null;
  title: string | null;
  /** Newest first, one per interview. */
  interviews: PersonInterview[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COUNT_BANDS = ["None", "1", "2–3", "4+"];
const PARTS = ["participant", "interviewer", "both", "other"];
const PART_LABEL: Record<string, string> = { participant: "Participant", interviewer: "Interviewer", both: "Interviewer and participant", other: "Other" };
const alpha = ["A → Z", "Z → A"] as [string, string];

/** Interviewer, participant, both, or other, across their interviews. */
export function partOf(p: PersonRow): string {
  const roles = new Set(p.interviews.map((i) => i.role));
  if (!roles.size) return NONE;
  if (roles.has("interviewer") && roles.has("participant")) return "both";
  return roles.has("participant") ? "participant" : roles.has("interviewer") ? "interviewer" : "other";
}

export const clientsOf = (p: PersonRow) => [...new Set(p.interviews.map((i) => i.client).filter((c): c is string => !!c))].sort();

function countBand(n: number): string {
  return n === 0 ? COUNT_BANDS[0] : n === 1 ? COUNT_BANDS[1] : n <= 3 ? COUNT_BANDS[2] : COUNT_BANDS[3];
}

/** The People table's columns. `orgPath` names organizations; `dupes` holds
 *  the ids of possible duplicates (see possibleDuplicates). */
export function peopleColumns(orgPath: Map<string, string>, dupes: Set<string>): Column<PersonRow>[] {
  return [
    {
      key: "name",
      name: "Name",
      bucket: (r) => r.name.trim().charAt(0).toUpperCase().replace(/[^\p{L}]/u, "#") || NONE,
      label: (b) => (b === NONE ? "No name" : b),
      rank: (b) => b,
      sortValue: (r) => r.name.toLowerCase(),
      sortLabels: alpha,
    },
    {
      key: "duplicate",
      name: "Possible duplicate",
      bucket: (r) => (dupes.has(r.id) ? "yes" : "no"),
      label: (b) => (b === "yes" ? "Possible duplicate" : "No likely duplicate"),
      rank: (b) => (b === "yes" ? 0 : 1),
      sortValue: (r) => (dupes.has(r.id) ? 0 : 1),
      sortLabels: ["Duplicates first", "Duplicates last"],
    },
    {
      key: "organization",
      name: "Organization",
      bucket: (r) => r.organizationId ?? NONE,
      label: (b) => (b === NONE ? "No organization" : (orgPath.get(b) ?? "Removed organization")),
      rank: (b) => (orgPath.get(b) ?? b).toLowerCase(),
      sortValue: (r) => (r.organizationId ? (orgPath.get(r.organizationId) ?? "").toLowerCase() : null),
      sortLabels: alpha,
    },
    {
      key: "topOrganization",
      name: "Top organization",
      bucket: (r) => (r.organizationId && orgPath.has(r.organizationId) ? topOf(orgPath.get(r.organizationId)!) : NONE),
      label: (b) => (b === NONE ? "No organization" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => (r.organizationId && orgPath.has(r.organizationId) ? topOf(orgPath.get(r.organizationId)!).toLowerCase() : null),
      sortLabels: alpha,
    },
    {
      key: "title",
      name: "Title",
      bucket: (r) => r.title?.trim() || NONE,
      label: (b) => (b === NONE ? "No title" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => r.title?.toLowerCase() ?? null,
      sortLabels: alpha,
    },
    {
      key: "part",
      name: "Part",
      bucket: partOf,
      label: (b) => (b === NONE ? "In no interview" : PART_LABEL[b]),
      rank: (b) => PARTS.indexOf(b),
      sortValue: (r) => {
        const b = partOf(r);
        return b === NONE ? null : PARTS.indexOf(b);
      },
      sortLabels: ["Participants first", "Others first"],
    },
    {
      key: "clients",
      name: "Clients",
      bucket: (r) => clientsOf(r).join(", ") || NONE,
      label: (b) => (b === NONE ? "No client yet" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => clientsOf(r).join(", ").toLowerCase() || null,
      sortLabels: alpha,
    },
    {
      key: "interviews",
      name: "Interviews",
      bucket: (r) => countBand(r.interviews.length),
      label: (b) => (b === "None" ? "In no interview" : `${b} interview${b === "1" ? "" : "s"}`),
      rank: (b) => COUNT_BANDS.indexOf(b),
      sortValue: (r) => r.interviews.length,
      sortLabels: ["Fewest first", "Most first"],
    },
    {
      key: "latest",
      name: "Latest",
      bucket: (r) => r.interviews[0]?.date.slice(0, 7) ?? NONE,
      label: (b) => (b === NONE ? "No interviews" : `${MONTHS[Number(b.slice(5, 7)) - 1]} ${b.slice(0, 4)}`),
      rank: (b) => -Number(b.replace("-", "")),
      sortValue: (r) => r.interviews[0]?.date ?? null,
      sortLabels: ["Oldest first", "Newest first"],
    },
  ];
}
