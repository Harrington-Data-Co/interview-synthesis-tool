import { ApiError, errorResponse } from "@/lib/api";
import { loadMemo } from "@/lib/memo/load";
import { memoMarkdown } from "@/lib/memo/markdown";
import { currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The memo as a Markdown file, citations as footnotes. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await currentSeat())) throw new ApiError("Sign in with a seat on this workspace.", 401);
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Unknown memo.", 404);
    const supabase = await createClient();
    const { data: product } = await supabase.from("product").select("project_id,template_id").eq("id", id).maybeSingle();
    if (!product) throw new ApiError("Unknown memo.", 404);
    const memo = await loadMemo(supabase, product.project_id, product.template_id);
    if (!memo?.template || !memo.product) throw new ApiError("Unknown memo.", 404);

    const participant = new Map(memo.interviews.map((i) => [i.id, i.participant]));
    const md = memoMarkdown({
      title: memo.product.title,
      project: memo.project.name,
      client: memo.project.client,
      sections: memo.template.sections.map((s) => ({
        name: s.name,
        paragraphs: memo.paragraphs
          .filter((p) => p.sectionId === s.id)
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((p) => ({ text: p.text, themes: p.themeIds, codes: p.codeIds })),
      })),
      themes: new Map(memo.themes.map((t) => [t.id, { ref: t.ref, title: t.title }])),
      codes: new Map(memo.codes.map((c) => [c.id, { key: c.key, participant: participant.get(c.transcriptId) ?? null, verbatim: c.verbatim }])),
    });
    const filename = `${(memo.product.title ?? memo.template.name).replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "memo"}.md`;
    return new Response(md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
