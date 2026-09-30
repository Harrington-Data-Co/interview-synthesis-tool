import {
  applyView as applyTableView,
  NONE,
  type Column as TableColumn,
  type Group as TableGroup,
  type View,
} from "@/components/table/view";
import { topOf } from "@/lib/directory";
import type { LabelAxis, LabelMap } from "./labels";

// The engine is shared (components/table/view); these are the Interviews
// table's own columns.
export { countsFor, EMPTY_VIEW, filtered, NONE, sanitize } from "@/components/table/view";
export type { Count, View } from "@/components/table/view";
export type Column = TableColumn<InterviewRow>;
export type Group = TableGroup<InterviewRow>;
export const applyView = (rows: InterviewRow[], columns: Column[], view: View): Group[] => applyTableView(rows, columns, view);

/** One interview as the project table shows it. */
export type InterviewRow = {
  id: string;
  title: string;
  /** Participant display names; empty when none is marked. */
  participants: string[];
  /** Organization paths of the participants. */
  organizations: string[];
  /** The same organizations, by id (for grouping by kind). */
  organizationIds?: string[];
  recordedOn: string | null;
  durationMins: number | null;
  source: string;
  status: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LENGTH_BANDS = ["Under 30 min", "30–44 min", "45–59 min", "60+ min"];
const STATUS_ORDER = ["new", "queued", "coded"];

function lengthBand(mins: number | null): string {
  if (mins === null) return NONE;
  if (mins < 30) return LENGTH_BANDS[0];
  if (mins < 45) return LENGTH_BANDS[1];
  if (mins < 60) return LENGTH_BANDS[2];
  return LENGTH_BANDS[3];
}

const joined = (xs: string[]) => (xs.length ? xs.join(", ") : NONE);
const alpha = ["A → Z", "Z → A"] as [string, string];

/** The table's groupable, filterable, sortable columns, including one per
 *  label axis (grouped under the Labels header). */
export function columnsFor(axes: LabelAxis[], labels: LabelMap): Column[] {
  const base: Column[] = [
    {
      key: "participant",
      name: "Participant",
      bucket: (r) => joined(r.participants),
      label: (b) => (b === NONE ? "No participant marked" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => (r.participants.length ? r.participants.join(", ").toLowerCase() : null),
      sortLabels: alpha,
    },
    {
      key: "organization",
      name: "Organization",
      bucket: (r) => joined(r.organizations),
      label: (b) => (b === NONE ? "No organization" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => (r.organizations.length ? r.organizations.join(", ").toLowerCase() : null),
      sortLabels: alpha,
    },
    {
      key: "topOrganization",
      name: "Top organization",
      bucket: (r) => joined([...new Set(r.organizations.map(topOf))]),
      label: (b) => (b === NONE ? "No organization" : b),
      rank: (b) => b.toLowerCase(),
      sortValue: (r) => (r.organizations.length ? [...new Set(r.organizations.map(topOf))].join(", ").toLowerCase() : null),
      sortLabels: alpha,
    },
    {
      key: "recorded",
      name: "Recorded",
      bucket: (r) => r.recordedOn?.slice(0, 7) ?? NONE,
      label: (b) => (b === NONE ? "Undated" : `${MONTHS[Number(b.slice(5, 7)) - 1]} ${b.slice(0, 4)}`),
      // Newest month first.
      rank: (b) => -Number(b.replace("-", "")),
      sortValue: (r) => r.recordedOn,
      sortLabels: ["Oldest first", "Newest first"],
    },
    {
      key: "length",
      name: "Length",
      bucket: (r) => lengthBand(r.durationMins),
      label: (b) => (b === NONE ? "Unknown length" : b),
      rank: (b) => LENGTH_BANDS.indexOf(b),
      sortValue: (r) => r.durationMins,
      sortLabels: ["Shortest first", "Longest first"],
    },
    {
      key: "status",
      name: "Status",
      bucket: (r) => r.status,
      label: (b) => b,
      rank: (b) => STATUS_ORDER.indexOf(b),
      sortValue: (r) => STATUS_ORDER.indexOf(r.status),
      sortLabels: ["New first", "Coded first"],
    },
  ];

  const labelCols: Column[] = axes.map((a) => {
    const optionOf = (r: InterviewRow) => a.options.find((o) => o.id === labels[r.id]?.[a.id]);
    return {
      key: `label:${a.id}`,
      name: a.name,
      bucket: (r) => optionOf(r)?.id ?? NONE,
      label: (b) => (b === NONE ? "Unlabelled" : (a.options.find((o) => o.id === b)?.value ?? "Removed option")),
      // The axis's own option order.
      rank: (b) => a.options.findIndex((o) => o.id === b),
      sortValue: (r) => optionOf(r)?.value.toLowerCase() ?? null,
      sortLabels: alpha,
    };
  });

  return [...base, ...labelCols];
}

