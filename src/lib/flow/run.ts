import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emptyUsage, structuredCall, type Usage } from "@/lib/claude/call";
import type { MapProposal } from "./gate";
import { FLOW_SYSTEM, flowMessage, type FlowCode, type FlowInterview } from "./prompt";

export const flowResponseSchema = z.object({
  maps: z.array(
    z.object({
      title: z.string(),
      scope: z.string(),
      lanes: z.array(z.string()),
      steps: z.array(
        z.object({
          lane: z.string(),
          position: z.number().int(),
          label: z.string(),
          kind: z.enum(["task", "wait", "decision"]),
          note: z.string(),
          codes: z.array(z.string()),
        }),
      ),
    }),
  ),
});

/** Draw the process maps. Returns Claude's maps unchecked; gateMaps() and
 *  the database decide what's kept. */
export async function drawMaps(
  ctx: { project: string; client: string | null; interviews: FlowInterview[] },
  themes: { ref: string; title: string }[],
  codes: FlowCode[],
  client: Anthropic = new Anthropic(),
): Promise<{ proposals: MapProposal[]; usage: Usage }> {
  const usage = emptyUsage();
  const read = await structuredCall(client, {
    system: FLOW_SYSTEM,
    user: flowMessage(ctx, themes, codes),
    schema: flowResponseSchema,
    what: "draw these process maps",
    usage,
  });
  return { proposals: read.maps, usage };
}
