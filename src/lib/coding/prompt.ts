/** Bump when the instructions or the output shape change, so every run
 *  records which prompt produced its codes. */
export const PROMPT_VERSION = "coding-v2";

export { MODEL, EFFORT } from "@/lib/claude/call";

export const CLAUDE_CODE_TYPES = ["Pain", "Step", "Tool", "Goal", "Constraint", "Question"] as const;
export type ClaudeCodeType = (typeof CLAUDE_CODE_TYPES)[number];

export type CodingLine = {
  n: number;
  speaker: string; // as written in the transcript
  text: string;
  role: "interviewer" | "participant" | "other";
  displayName: string | null;
};

/** Someone in the interview, as the header lists them. */
export type InterviewPerson = {
  name: string;
  role: CodingLine["role"];
  title: string | null;
  organization: string | null;
};

export type TranscriptContext = {
  title: string;
  /** Everyone who speaks, once per person (two export names for one person
   *  are listed once). */
  people: InterviewPerson[];
};

const PART: Record<CodingLine["role"], string> = { interviewer: "interviewer", participant: "participant", other: "other" };

/** Stable across every run (and so cacheable): what coding means here. */
export const SYSTEM = `You are coding a discovery interview for Harrington Data Co, a data consultancy. The interviews study how people's work actually happens today — the steps, the systems, what goes wrong — so a team can design better data, reporting and processes. Your codes are the evidence everything later is built on: interview notes, themes across interviews, and a findings memo a client will read. Each one must be something the participant actually said.

Code types — use exactly these:
- Pain: something that costs time, money, accuracy or trust; a frustration, workaround, failure or risk.
- Step: a step in how the work is actually done today — who does what, when, in what order.
- Tool: a system, spreadsheet, report, form or data source they use or depend on, and how they use it.
- Goal: an outcome they want, a decision they need to make, or what "good" would look like.
- Constraint: a rule, policy, law, funding term, dependency, capacity limit or deadline that shapes the work.
- Question: an open question — something they don't know, can't find out, or want answered.

How to code:
1. Quote only participant lines, marked [P]. Lines marked [I] are the interviewer and are context only; never quote them.
2. The verbatim is copied character for character from the transcript: same words, spelling, capitalisation, punctuation and filler words ("um", "like"). Do not correct transcription errors, tidy grammar, or join words from different places. Choose the shortest span that carries the point — usually a clause or a sentence, rarely more than 40 words.
3. line_start and line_end are the numbers of the lines the quote begins and ends in. Most quotes sit in one line (line_start equals line_end). A quote that runs across lines treats consecutive lines as joined by a single space; only do this when both lines are the participant's.
4. The label is a short, specific finding in your own words, at most 10 words — "Enrollment counts rebuilt by hand each month", not "Manual process".
5. The note is one sentence of context that makes the code understandable on its own — what it refers to, or why it matters — or an empty string if the quote speaks for itself.
6. Work through the whole interview. Code every distinct, substantive point: when the same point comes up again with new detail, code it again at that place. Skip greetings, scheduling, small talk and the interviewer's framing. A single quote may support two codes of different types if both are genuinely there.
7. Stay with what is said. Don't infer causes, intentions or facts the participant didn't state.`;

const roleTag = (r: CodingLine["role"]) => (r === "interviewer" ? "I" : "P");

/** The transcript as Claude reads it: a header, then one numbered line per
 *  turn, tagged [P] (may be quoted) or [I] (context only). */
export function transcriptMessage(
  ctx: TranscriptContext,
  lines: CodingLine[],
  part?: { index: number; total: number; codeFrom: number },
): string {
  const header = [
    `Interview: ${ctx.title}`,
    ctx.people.length > 0 &&
      `People:\n${ctx.people.map((p) => `- ${p.name} (${PART[p.role]})${[p.title, p.organization].filter(Boolean).map((x) => `, ${x}`).join("")}`).join("\n")}`,
  ].filter(Boolean);

  const scope = part
    ? `This is part ${part.index} of ${part.total} of a long interview. Lines before L${part.codeFrom} repeat the end of the previous part as context; code only from L${part.codeFrom} onward.`
    : "Code the whole interview.";

  const body = lines
    .map((l) => `L${l.n} [${roleTag(l.role)}] ${l.displayName ?? l.speaker}: ${l.text}`)
    .join("\n");

  return `${header.join("\n")}\n\n${scope}\n\n<transcript>\n${body}\n</transcript>`;
}
