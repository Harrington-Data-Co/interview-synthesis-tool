import type { SheetSpec } from "./sheet";

export type ExportLine = { n: number; at: string | null; speaker: string; role: string; text: string };
export type ExportCode = {
  id: string;
  ref: string;
  type: string;
  label: string;
  verbatim: string;
  note: string | null;
  line_start: number;
  line_end: number;
  origin: string;
  merged_into_id: string | null;
};

const lines = (c: { line_start: number; line_end: number }) => (c.line_start === c.line_end ? `L${c.line_start}` : `L${c.line_start}–${c.line_end}`);

/** Stage 02 as a spreadsheet: every line of the transcript with the codes
 *  that cover it beside it, and the codes themselves on a second sheet.
 *  Merged codes are listed (naming what they were merged into) but don't
 *  mark lines — the code they became does. */
export function codingSheets(codes: ExportCode[], transcript: ExportLine[]): SheetSpec[] {
  const active = codes.filter((c) => !c.merged_into_id);
  const refOf = new Map(codes.map((c) => [c.id, c.ref]));
  return [
    {
      name: "Transcript",
      columns: [
        { header: "Line", key: "n", width: 7 },
        { header: "Time", key: "at", width: 10 },
        { header: "Speaker", key: "speaker", width: 22 },
        { header: "Role", key: "role", width: 12 },
        { header: "Text", key: "text", width: 90, wrap: true },
        { header: "Codes", key: "codes", width: 48, wrap: true },
      ],
      rows: transcript.map((l) => ({
        n: l.n,
        at: l.at,
        speaker: l.speaker,
        role: l.role,
        text: l.text,
        codes: active
          .filter((c) => c.line_start <= l.n && l.n <= c.line_end)
          .map((c) => `${c.ref} · ${c.type}: ${c.label}`)
          .join("\n"),
      })),
    },
    {
      name: "Codes",
      columns: [
        { header: "Code", key: "ref", width: 12 },
        { header: "Type", key: "type", width: 13 },
        { header: "Label", key: "label", width: 40, wrap: true },
        { header: "Participant's words", key: "verbatim", width: 80, wrap: true },
        { header: "Lines", key: "lines", width: 11 },
        { header: "Note", key: "note", width: 40, wrap: true },
        { header: "Made by", key: "origin", width: 10 },
        { header: "Merged into", key: "merged", width: 12 },
      ],
      rows: codes.map((c) => ({
        ref: c.ref,
        type: c.type,
        label: c.label,
        verbatim: c.verbatim,
        lines: lines(c),
        note: c.note,
        origin: c.origin === "claude" ? "Claude" : "Person",
        merged: c.merged_into_id ? (refOf.get(c.merged_into_id) ?? "") : null,
      })),
    },
  ];
}
