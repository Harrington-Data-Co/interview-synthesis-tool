import type { FlowCode, FlowInterview } from "@/lib/flow/prompt";

/** Bump when the instructions or the output shape change. */
export const ARCH_PROMPT_VERSION = "arch-v1";

/** The code types an architecture map is drawn from. */
export const ARCH_CODE_TYPES = ["Tool", "Step", "Stakeholder", "Pain", "Constraint"] as const;

export const NODE_KINDS = ["system", "spreadsheet", "document", "communication", "manual", "external"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const ARCH_SYSTEM = `You are drawing a current-state architecture for Harrington Data Co, a data consultancy, to give to its client. It shows the systems as the people interviewed described using them — not as documented or intended — and how data actually moves between them.

How to draw it:
1. Draw what participants said they use and do now. Every system, flow and gap must be supported by the codes it cites; invent nothing, and don't name systems nobody mentioned.
2. Usually one map; a second only if the interviews describe a clearly separate landscape (a different department's systems that never touch the first). Give each a title and a one-sentence scope.
3. Systems are the places data lives or passes through. Kind: "system" (an application or platform), "spreadsheet", "document" (reports, templates, shared docs), "communication" (email, chat, phone), "manual" (paper, memory, a person's own notes), "external" (an outside party's system or portal). Name each as participants did ("Foundant", "Board book spreadsheet"); one entry per system.
4. Mark a system official: false when it's a workaround people built or adopted to fill a gap (a shadow spreadsheet, a personal tracker, an email thread used as a database). Official systems are the ones the organization runs on purpose.
5. Flows: what moves from one system to another ("Award totals", "Site visit notes"), named by the systems' names exactly as listed. manual: true when a person moves it (re-keys, copies, exports and uploads, emails, prints and scans); false only when participants said the systems exchange it themselves.
6. Gaps: three to eight problems the map shows — missing connections, the same data kept in several places, data nobody owns, reports nobody can get. Each a short title and one sentence of note. Don't number them; the app does.
7. Every system, flow and gap cites the codes (by key, for example I3:TOOL-02) that support it — at least one, only keys from the list. Cite Pain and Constraint codes on the flows and gaps they're about.
8. Refer to people by role, never by name.`;

/** Codes grouped by type, the interviews they come from and the confirmed
 *  themes, as Claude reads them. */
export function archMessage(
  ctx: { project: string; client: string | null; interviews: FlowInterview[] },
  themes: { ref: string; title: string }[],
  codes: FlowCode[],
): string {
  const who = ctx.interviews.map((i) => `${i.key}: ${[i.role, i.organization].filter(Boolean).join(", ") || "participant"}`).join("\n");
  const byType = ARCH_CODE_TYPES.map((t) => {
    const cs = codes.filter((c) => c.type === t);
    return cs.length ? `[${t}]\n${cs.map((c) => `${c.key} ${c.label} — “${c.verbatim}”`).join("\n")}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
  return [
    `Project: ${ctx.project}${ctx.client ? ` for ${ctx.client}` : ""} · ${ctx.interviews.length} interviews`,
    `<interviews>\n${who}\n</interviews>`,
    `<confirmed_themes>\n${themes.map((t) => `${t.ref}. ${t.title}`).join("\n") || "(none yet)"}\n</confirmed_themes>`,
    `<codes>\n${byType || "(none)"}\n</codes>`,
  ].join("\n\n");
}
