/** Bump when the instructions or the output shape change. */
export const FLOW_PROMPT_VERSION = "flow-v1";

/** The code types a process map is drawn from. */
export const FLOW_CODE_TYPES = ["Step", "Tool", "Stakeholder", "Pain", "Constraint"] as const;

export type FlowCode = {
  id: string;
  key: string; // I3:STEP-02
  type: string;
  label: string;
  verbatim: string;
};

export type FlowInterview = { key: string; role: string | null; organization: string | null };

export const FLOW_SYSTEM = `You are drawing current-state process maps — swimlane diagrams — for Harrington Data Co, a data consultancy, to give to its client. They show how work actually gets done today, as the people interviewed described it.

How to draw them:
1. Map what participants said they do now, not what they should do or what a system is supposed to do. Every step must be supported by the codes it cites; invent nothing.
2. Choose the one to three processes the interviews describe most fully and that matter most (the confirmed themes show what matters). Each map is one process with a clear start and end: say them in the scope, in one sentence.
3. Lanes are who does the work: roles, teams or systems ("Program officer", "Finance", "Grants system"). Never people's names. Two to six lanes per map; list them in the order the work first reaches them.
4. Steps are short verb phrases in plain language ("Re-keys totals into the reporting template"), in the lane of whoever or whatever does them, in order: position 1, 2, 3… Steps done at the same time in different lanes may share a position; a lane has at most one step per position.
5. Each step has a kind. "task": someone does something. "wait": the work stops for someone or something (an approval, a batch, an email reply) — mark these, they're where time goes. "decision": a choice that sends the work different ways; phrase it as a question.
6. Every step cites the codes (by key, for example I3:STEP-02) that describe it — at least one, only keys from the list. Cite Pain and Constraint codes on the step they're about, so the map shows where it hurts.
7. Where participants' accounts differ, map the common path and put the variation in the step's note, briefly. Otherwise leave the note empty.
8. Name each step's lane exactly as written in that map's lanes.`;

/** Codes, with the interviews they come from and the confirmed themes, as
 *  Claude reads them. */
export function flowMessage(
  ctx: { project: string; client: string | null; interviews: FlowInterview[] },
  themes: { ref: string; title: string }[],
  codes: FlowCode[],
): string {
  const who = ctx.interviews
    .map((i) => `${i.key}: ${[i.role, i.organization].filter(Boolean).join(", ") || "participant"}`)
    .join("\n");
  const byType = FLOW_CODE_TYPES.map((t) => {
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
