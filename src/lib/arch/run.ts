import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emptyUsage, structuredCall, type Usage } from "@/lib/claude/call";
import type { FlowCode, FlowInterview } from "@/lib/flow/prompt";
import type { ArchProposal } from "./gate";
import { ARCH_SYSTEM, NODE_KINDS, archMessage } from "./prompt";

export const archResponseSchema = z.object({
  maps: z.array(
    z.object({
      title: z.string(),
      scope: z.string(),
      systems: z.array(z.object({ name: z.string(), kind: z.enum(NODE_KINDS), official: z.boolean(), note: z.string(), codes: z.array(z.string()) })),
      flows: z.array(z.object({ from: z.string(), to: z.string(), carries: z.string(), manual: z.boolean(), note: z.string(), codes: z.array(z.string()) })),
      gaps: z.array(z.object({ title: z.string(), note: z.string(), codes: z.array(z.string()) })),
    }),
  ),
});

/** Draw the architecture. Returns Claude's maps unchecked; gateArch() and the
 *  database decide what's kept. */
export async function drawArch(
  ctx: { project: string; client: string | null; interviews: FlowInterview[] },
  themes: { ref: string; title: string }[],
  codes: FlowCode[],
  client: Anthropic = new Anthropic(),
): Promise<{ proposals: ArchProposal[]; usage: Usage }> {
  const usage = emptyUsage();
  const read = await structuredCall(client, {
    system: ARCH_SYSTEM,
    user: archMessage(ctx, themes, codes),
    schema: archResponseSchema,
    what: "draw this architecture",
    usage,
  });
  return { proposals: read.maps, usage };
}
