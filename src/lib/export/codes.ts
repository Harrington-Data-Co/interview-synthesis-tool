import type { SheetSpec } from "./sheet";

export type CodesExport = {
  interviews: {
    id: string;
    key: string;
    title: string;
    participant: string | null;
    organization: string | null;
    role: string | null;
    recordedOn: string | null;
    source: string;
    status: string;
  }[];
  codes: {
    id: string;
    transcriptId: string;
    ref: string;
    type: string;
    label: string;
    verbatim: string;
    note: string | null;
    line_start: number;
    line_end: number;
    origin: string;
    merged_into_id: string | null;
  }[];
  /** Theme refs by code id. */
  themesOf: Map<string, string[]>;
  themes: { ref: string; title: string; status: string }[];
};

const lines = (c: { line_start: number; line_end: number }) => (c.line_start === c.line_end ? `L${c.line_start}` : `L${c.line_start}–${c.line_end}`);

/** Every code across a project's interviews on one sheet, beside the
 *  interview and participant it came from and the themes it feeds — enough
 *  to rebuild the coding without the app. Interviews and themes get their
 *  own sheets as keys. */
export function codesSheets(p: CodesExport): SheetSpec[] {
  const iv = new Map(p.interviews.map((i) => [i.id, i]));
  const byId = new Map(p.codes.map((c) => [c.id, c]));
  const counts = new Map<string, number>();
  for (const c of p.codes) if (!c.merged_into_id) counts.set(c.transcriptId, (counts.get(c.transcriptId) ?? 0) + 1);
  return [
    {
      name: "Codes",
      columns: [
        { header: "Interview", key: "key", width: 10 },
        { header: "Code", key: "code", width: 14 },
        { header: "Type", key: "type", width: 13 },
        { header: "Label", key: "label", width: 40, wrap: true },
        { header: "Participant's words", key: "verbatim", width: 80, wrap: true },
        { header: "Lines", key: "lines", width: 11 },
        { header: "Note", key: "note", width: 40, wrap: true },
        { header: "Made by", key: "origin", width: 10 },
        { header: "Merged into", key: "merged", width: 14 },
        { header: "Themes", key: "themes", width: 16 },
        { header: "Interview title", key: "title", width: 30, wrap: true },
        { header: "Participant", key: "participant", width: 22 },
        { header: "Organization", key: "organization", width: 24 },
        { header: "Role", key: "role", width: 24 },
      ],
      rows: p.codes.map((c) => {
        const i = iv.get(c.transcriptId);
        const target = c.merged_into_id ? byId.get(c.merged_into_id) : undefined;
        return {
          key: i?.key ?? "",
          code: i?.key ? `${i.key}:${c.ref}` : c.ref,
          type: c.type,
          label: c.label,
          verbatim: c.verbatim,
          lines: lines(c),
          note: c.note,
          origin: c.origin === "claude" ? "Claude" : "Person",
          merged: target ? target.ref : c.merged_into_id ? "(removed)" : null,
          themes: (p.themesOf.get(c.id) ?? []).join(", "),
          title: i?.title ?? "",
          participant: i?.participant ?? null,
          organization: i?.organization ?? null,
          role: i?.role ?? null,
        };
      }),
    },
    {
      name: "Interviews",
      columns: [
        { header: "Interview", key: "key", width: 10 },
        { header: "Title", key: "title", width: 36, wrap: true },
        { header: "Participant", key: "participant", width: 22 },
        { header: "Organization", key: "organization", width: 24 },
        { header: "Role", key: "role", width: 24 },
        { header: "Recorded", key: "recordedOn", width: 12 },
        { header: "Source", key: "source", width: 16 },
        { header: "Status", key: "status", width: 10 },
        { header: "Codes", key: "codes", width: 8 },
      ],
      rows: p.interviews.map((i) => ({ ...i, codes: counts.get(i.id) ?? 0 })),
    },
    {
      name: "Themes",
      columns: [
        { header: "Theme", key: "ref", width: 10 },
        { header: "Title", key: "title", width: 60, wrap: true },
        { header: "Status", key: "status", width: 12 },
      ],
      rows: p.themes.map((t) => ({ ...t, status: t.status === "confirmed" ? "Confirmed" : "Proposed" })),
    },
  ];
}
