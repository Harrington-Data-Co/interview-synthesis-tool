import { createClient } from "@/lib/supabase/server";
import { loadProjectEvidence } from "@/lib/themes/evidence";
import { ThemesView } from "./ThemesView";
import type { ThemeRejectionView, ThemeRunView, ThemeView } from "./types";

/** Loads the Themes view: the project's evidence, its themes (with members,
 *  whether the memo cites them, and their latest revertible edit), proposals
 *  awaiting review, and recent runs. */
export async function ThemesStage({ projectId, editor }: { projectId: string; editor: boolean }) {
  const supabase = await createClient();
  const [evidence, { data: themeRows }, { data: rejections }, { data: runs }, { data: seats }] = await Promise.all([
    loadProjectEvidence(supabase, projectId),
    supabase
      .from("theme")
      .select("id,ref,title,description,status,origin,ordinal,codes:theme_code(code_id),cited:product_item_theme(item_id)")
      .eq("project_id", projectId)
      .order("status", { ascending: true })
      .order("ordinal"),
    supabase
      .from("theme_rejection")
      .select("id,reason,proposal")
      .eq("project_id", projectId)
      .is("resolution", null)
      .order("created_at"),
    supabase
      .from("theme_run")
      .select("status,started_at,started_by,accepted,rejected,cost_usd,error")
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(3),
    supabase.from("seat").select("user_id,name"),
  ]);
  const who = new Map((seats ?? []).map((s) => [s.user_id, s.name]));

  const ids = (themeRows ?? []).map((t) => t.id);
  const lastEdit = new Map<string, ThemeView["lastEdit"]>();
  if (ids.length) {
    const { data: edits } = await supabase
      .from("edit")
      .select("object_id,text,edited_by")
      .eq("object_type", "theme")
      .eq("reverted", false)
      .not("before", "is", null)
      .not("after", "is", null)
      .in("object_id", ids)
      .order("edited_at", { ascending: false });
    for (const e of edits ?? []) {
      if (!lastEdit.has(e.object_id)) lastEdit.set(e.object_id, { text: e.text, by: who.get(e.edited_by) ?? "someone" });
    }
  }

  // Most-supported first within each status: confirmed, then proposed.
  const active = new Set(evidence.codes.map((c) => c.id));
  const themes: ThemeView[] = (themeRows ?? [])
    .map((t) => ({
      id: t.id,
      ref: t.ref,
      title: t.title,
      description: t.description,
      status: t.status as ThemeView["status"],
      origin: t.origin as ThemeView["origin"],
      codeIds: (t.codes ?? []).map((c: { code_id: string }) => c.code_id).filter((id: string) => active.has(id)),
      citedByMemo: (t.cited ?? []).length > 0,
      lastEdit: lastEdit.get(t.id) ?? null,
    }))
    .sort((a, b) => (a.status === b.status ? b.codeIds.length - a.codeIds.length : a.status === "confirmed" ? -1 : 1));

  return (
    <ThemesView
      projectId={projectId}
      editor={editor}
      interviews={evidence.interviews}
      codes={evidence.codes}
      themes={themes}
      rejections={(rejections ?? []) as ThemeRejectionView[]}
      runs={(runs ?? []).map((r) => ({ ...r, started_by: who.get(r.started_by) ?? "someone" })) as ThemeRunView[]}
    />
  );
}
