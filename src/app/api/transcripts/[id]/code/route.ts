import { ApiError, errorResponse, requireEditor } from "@/lib/api";
import { claudeErrorResponse } from "@/lib/claude/respond";
import { withPaths } from "@/lib/directory";
import { gate } from "@/lib/coding/gate";
import { EFFORT, MODEL, PROMPT_VERSION, type CodingLine } from "@/lib/coding/prompt";
import { codeTranscript, CodingError, type Usage } from "@/lib/coding/run";
import { createClient } from "@/lib/supabase/server";

// A pass is one streamed call per chunk; a long interview at high effort can
// take a few minutes.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

/** Run Claude's coding pass on a transcript.
 *
 *  Body: { replace?: boolean }. A transcript that already has Claude's codes
 *  is refused (409) unless `replace` is set, which discards them — never the
 *  codes people made — before coding again. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  let runId: string | null = null;
  const supabase = await createClient();
  try {
    await requireEditor();
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown transcript.", 404);
    const body = (await request.json().catch(() => ({}))) as { replace?: unknown };

    const { data: t } = await supabase
      .from("transcript")
      .select("id,title,participant,participant_role")
      .eq("id", id)
      .maybeSingle();
    if (!t) throw new ApiError("Unknown transcript.", 404);

    const { count: existing } = await supabase
      .from("code")
      .select("id", { count: "exact", head: true })
      .eq("transcript_id", id)
      .eq("origin", "claude");
    if (existing && !body.replace) {
      throw new ApiError(`This transcript already has ${existing} of Claude's codes. Re-run to replace them.`, 409);
    }

    // Lines, and who's speaking.
    const raw: { n: number; speaker: string; text: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from("transcript_line")
        .select("n,speaker,text")
        .eq("transcript_id", id)
        .order("n")
        .range(from, from + PAGE - 1);
      raw.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    const [{ data: speakers }, { data: orgs }] = await Promise.all([
      supabase.from("transcript_speaker").select("name,role,display_name,organization_id").eq("transcript_id", id),
      supabase.from("organization").select("id,name,parent_id"),
    ]);
    const bySpeaker = new Map((speakers ?? []).map((s) => [s.name, s]));
    if (!(speakers ?? []).some((s) => s.role === "participant" || s.role === "other")) {
      throw new ApiError("No one in this transcript is marked as a participant, so there's nothing Claude may quote. Set roles in Edit record.");
    }
    const lines: CodingLine[] = raw.map((l) => ({
      ...l,
      role: (bySpeaker.get(l.speaker)?.role ?? "other") as CodingLine["role"],
      displayName: bySpeaker.get(l.speaker)?.display_name ?? null,
    }));
    const orgPath = new Map(withPaths(orgs ?? []).map((o) => [o.id, o.path]));
    const participantOrgs = [
      ...new Set(
        (speakers ?? [])
          .filter((s) => s.role === "participant" && s.organization_id)
          .map((s) => orgPath.get(s.organization_id as string))
          .filter((p): p is string => !!p),
      ),
    ];

    const { data: run, error: startError } = await supabase.rpc("start_coding_run", {
      p_transcript_id: id,
      p_model: MODEL,
      p_effort: EFFORT,
      p_prompt_version: PROMPT_VERSION,
    });
    if (startError) {
      if (startError.code === "P0001") throw new ApiError(startError.message, 409);
      throw startError;
    }
    runId = run as string;

    const { proposals, usage } = await codeTranscript(
      { title: t.title, participant: t.participant, participantRole: t.participant_role, organizations: participantOrgs },
      lines,
    );
    const { accepted, rejected } = gate(proposals, lines);

    // Only now, with the new codes in hand, clear the old ones: a pass that
    // fails leaves the previous codes where they were.
    if (existing && body.replace) {
      const { error } = await supabase.rpc("discard_claude_codes", { p_transcript_id: id });
      if (error) throw error;
    }

    const { data: saved, error: saveError } = await supabase.rpc("save_coding_run", {
      p_run_id: runId,
      p_codes: accepted,
      p_rejections: rejected,
      p_usage: usage,
    });
    if (saveError) throw saveError;

    return Response.json({ runId, ...(saved as { accepted: number; rejected: number }), costUsd: usage.cost_usd });
  } catch (e) {
    if (runId) {
      const usage: Partial<Usage> = e instanceof CodingError ? e.usage : {};
      const message = e instanceof Error ? e.message : String(e);
      await supabase.rpc("fail_coding_run", { p_run_id: runId, p_error: message, p_usage: usage });
    }
    const fromClaude = claudeErrorResponse(e);
    if (fromClaude) return fromClaude;
    return errorResponse(e);
  }
}
