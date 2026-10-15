import type { Block } from "./blocks";
import type { SheetSpec } from "./sheet";

export type ThemeExport = {
  project: string;
  client: string | null;
  themes: { id: string; ref: string; title: string; description: string | null; status: string; origin: string; codeIds: string[] }[];
  codes: Map<string, { key: string; transcriptId: string; type: string; label: string; verbatim: string; line_start: number; line_end: number }>;
  /** Interview id → who was interviewed. */
  interviews: Map<string, { key: string; title: string; participant: string | null; organization: string | null; role: string | null }>;
};

const lines = (c: { line_start: number; line_end: number }) => (c.line_start === c.line_end ? `L${c.line_start}` : `L${c.line_start}–${c.line_end}`);
const status = (s: string) => (s === "confirmed" ? "Confirmed" : "Proposed");
const who = (iv?: { key: string; participant: string | null; role: string | null }) =>
  iv ? [iv.key, [iv.participant, iv.role].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : "";

/** Themes for Markdown or Word: each with its description and the quotes
 *  that support it, attributed to interview and participant. */
export function themeBlocks(t: ThemeExport): Block[] {
  const blocks: Block[] = [
    { kind: "title", text: "Themes" },
    { kind: "meta", text: [t.project, t.client].filter(Boolean).join(" · ") },
  ];
  for (const th of t.themes) {
    const members = th.codeIds.map((id) => t.codes.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
    const ivs = new Set(members.map((c) => c.transcriptId)).size;
    blocks.push({ kind: "heading", text: `${th.ref} — ${th.title}` });
    blocks.push({ kind: "meta", text: `${status(th.status)} · ${members.length} codes across ${ivs} ${ivs === 1 ? "interview" : "interviews"}` });
    if (th.description) blocks.push({ kind: "para", text: th.description });
    for (const c of members) {
      blocks.push({ kind: "quote", text: c.verbatim, by: `${who(t.interviews.get(c.transcriptId))} (${c.key.split(":")[1]}, ${lines(c)})` });
    }
  }
  return blocks;
}

/** Themes for Excel: one row per theme, and one per theme-and-code so the
 *  evidence can be filtered and pivoted. */
export function themeSheets(t: ThemeExport): SheetSpec[] {
  const evidence = t.themes.flatMap((th) =>
    th.codeIds.flatMap((id) => {
      const c = t.codes.get(id);
      if (!c) return [];
      const iv = t.interviews.get(c.transcriptId);
      return [
        {
          theme: th.ref,
          themeTitle: th.title,
          status: status(th.status),
          code: c.key,
          type: c.type,
          label: c.label,
          verbatim: c.verbatim,
          lines: lines(c),
          interview: iv?.title ?? "",
          participant: iv?.participant ?? null,
          organization: iv?.organization ?? null,
          role: iv?.role ?? null,
        },
      ];
    }),
  );
  return [
    {
      name: "Themes",
      columns: [
        { header: "Theme", key: "ref", width: 10 },
        { header: "Title", key: "title", width: 48, wrap: true },
        { header: "Status", key: "status", width: 12 },
        { header: "Description", key: "description", width: 80, wrap: true },
        { header: "Made by", key: "origin", width: 10 },
        { header: "Codes", key: "codes", width: 8 },
        { header: "Interviews", key: "interviews", width: 11 },
      ],
      rows: t.themes.map((th) => {
        const members = th.codeIds.map((id) => t.codes.get(id)).filter((c) => !!c);
        return {
          ref: th.ref,
          title: th.title,
          status: status(th.status),
          description: th.description,
          origin: th.origin === "claude" ? "Claude" : "Person",
          codes: members.length,
          interviews: new Set(members.map((c) => c.transcriptId)).size,
        };
      }),
    },
    {
      name: "Evidence",
      columns: [
        { header: "Theme", key: "theme", width: 10 },
        { header: "Theme title", key: "themeTitle", width: 36, wrap: true },
        { header: "Status", key: "status", width: 12 },
        { header: "Code", key: "code", width: 14 },
        { header: "Type", key: "type", width: 13 },
        { header: "Label", key: "label", width: 36, wrap: true },
        { header: "Participant's words", key: "verbatim", width: 80, wrap: true },
        { header: "Lines", key: "lines", width: 11 },
        { header: "Interview", key: "interview", width: 30, wrap: true },
        { header: "Participant", key: "participant", width: 22 },
        { header: "Organization", key: "organization", width: 24 },
        { header: "Role", key: "role", width: 24 },
      ],
      rows: evidence,
    },
  ];
}
