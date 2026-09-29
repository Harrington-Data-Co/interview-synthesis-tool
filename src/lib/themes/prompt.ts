/** Bump when the instructions or the output shape change. */
export const THEME_PROMPT_VERSION = "themes-v1";

export type ThemeInterview = {
  key: string; // I1, I2…
  title: string;
  participant: string | null;
  organization: string | null;
};

export type ThemeCode = {
  id: string;
  key: string; // I3:PAIN-03 — refs repeat across interviews, so they carry the interview's key
  type: string;
  label: string;
  verbatim: string;
};

export const THEME_SYSTEM = `You are finding the themes across a set of discovery interviews for Harrington Data Co, a data consultancy. Each interview has been coded: every code is a short finding with the participant's own words as evidence. A theme is a finding that holds across interviews — the thing a client most needs to hear about how their work really happens.

How to find themes:
1. A theme's title is the finding itself, stated as a plain sentence a client could read on its own: "Enrollment counts are rebuilt by hand because no one trusts the system export" — not a topic label like "Data quality".
2. The description adds one or two sentences on what the codes show and where it holds, in the third person. Nothing the codes don't support: no recommendations, causes they don't state, or facts from outside the interviews.
3. Cite every code that supports the theme, by its key (for example I3:PAIN-03). Only keys from the code list. A code may support more than one theme when it genuinely does.
4. Prefer themes that recur across interviews; a theme resting on one interview is fine when it matters, and its description should say so.
5. Aim for the handful of themes that matter most — usually five to twelve — rather than one per code. Merge themes that are the same finding worded differently.
6. Some themes may already be established; they're listed for context. Don't propose them again. Propose only new themes.`;

/** Interviews, established themes and every code, as Claude reads them. */
export function themeMessage(
  project: string,
  interviews: ThemeInterview[],
  established: { ref: string; title: string }[],
  codes: ThemeCode[],
): string {
  const ivs = interviews
    .map((i) => `${i.key}. ${i.title}${i.participant ? ` — ${i.participant}` : ""}${i.organization ? `, ${i.organization}` : ""}`)
    .join("\n");
  const known = established.length
    ? established.map((t) => `${t.ref}. ${t.title}`).join("\n")
    : "(none yet)";
  const list = codes.map((c) => `${c.key} [${c.type}] ${c.label} — “${c.verbatim}”`).join("\n");
  return `Project: ${project}\n\n<interviews>\n${ivs}\n</interviews>\n\n<established_themes>\n${known}\n</established_themes>\n\n<codes>\n${list}\n</codes>`;
}
