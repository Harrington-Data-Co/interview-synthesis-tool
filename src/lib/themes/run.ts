import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emptyUsage, structuredCall, type Usage } from "@/lib/claude/call";
import type { ThemeProposal } from "./gate";
import { THEME_SYSTEM, themeMessage, type ThemeCode, type ThemeInterview } from "./prompt";

export const ThemeResponseSchema = z.object({
  themes: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      codes: z.array(z.string()),
    }),
  ),
});

/** Propose themes across a project's interviews. Returns Claude's themes
 *  unchecked; gateThemes() and the database decide what's kept. */
export async function proposeThemes(
  project: string,
  interviews: ThemeInterview[],
  established: { ref: string; title: string }[],
  codes: ThemeCode[],
  client: Anthropic = new Anthropic(),
): Promise<{ proposals: ThemeProposal[]; usage: Usage }> {
  const usage = emptyUsage();
  const read = await structuredCall(client, {
    system: THEME_SYSTEM,
    user: themeMessage(project, interviews, established, codes),
    schema: ThemeResponseSchema,
    what: "propose themes for this project",
    usage,
  });
  return { proposals: read.themes, usage };
}
