import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { loadDeck } from "@/lib/deck/load";
import { deckPptx } from "@/lib/deck/pptx";
import { currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The deck as an editable .pptx. Anyone with a seat may download it.
 *  ?template=<id> picks the deck; otherwise the project's first. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await currentSeat())) throw new ApiError("Sign in with a seat on this workspace.", 401);
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown project.", 404);
    const templateId = request.nextUrl.searchParams.get("template") ?? undefined;
    const supabase = await createClient();
    const deck = await loadDeck(supabase, id, templateId && UUID.test(templateId) ? templateId : undefined);
    if (!deck?.product || !deck.slides.length) throw new ApiError("There's no deck to download yet.", 404);
    const { data: people } = await supabase.from("transcript").select("id,participant_role").eq("project_id", id);
    const buf = await deckPptx(deck, new Map((people ?? []).map((p) => [p.id, p.participant_role as string | null])));
    const name = `${deck.project.name} - ${deck.template?.name ?? "Deck"}`.replace(/[^\w .()-]+/g, "").slice(0, 120);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${name}.pptx"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
