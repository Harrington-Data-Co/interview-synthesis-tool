import { loadMemo } from "@/lib/memo/load";
import { createClient } from "@/lib/supabase/server";
import { MemoView } from "./MemoView";

/** Loads the Memo view: the project's memo templates, the chosen template's
 *  memo with its paragraphs and citations, proposals awaiting review, recent
 *  runs, and the themes and codes a paragraph can cite. */
export async function MemoStage({ projectId, templateId, editor }: { projectId: string; templateId: string | undefined; editor: boolean }) {
  const supabase = await createClient();
  const memo = await loadMemo(supabase, projectId, templateId);
  if (!memo) return null;
  return <MemoView projectId={projectId} editor={editor} memo={memo} />;
}
