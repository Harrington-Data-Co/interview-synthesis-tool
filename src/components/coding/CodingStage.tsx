import { createClient } from "@/lib/supabase/server";
import { CodingView } from "./CodingView";
import type { CodeRow, LineRow, RejectionRow, RunRow } from "./types";

/** Loads what stage 02 shows — codes, their latest revertible edit, Claude's
 *  proposals awaiting review, and recent runs — and hands it to CodingView. */
export async function CodingStage({
  transcriptId,
  lines,
  editor,
}: {
  transcriptId: string;
  lines: LineRow[];
  editor: boolean;
}) {
  const supabase = await createClient();
  const [{ data: codes }, { data: rejections }, { data: runs }, { data: seats }] = await Promise.all([
    supabase
      .from("code")
      .select("id,ref,type,label,verbatim,note,line_start,line_end,origin,merged_into_id")
      .eq("transcript_id", transcriptId)
      .order("line_start")
      .order("ref"),
    supabase
      .from("code_rejection")
      .select("id,reason,proposal")
      .eq("transcript_id", transcriptId)
      .is("resolution", null)
      .order("created_at"),
    supabase
      .from("coding_run")
      .select("id,status,started_at,started_by,accepted,rejected,cost_usd,error,served_by")
      .eq("transcript_id", transcriptId)
      .order("started_at", { ascending: false })
      .limit(5),
    supabase.from("seat").select("user_id,name"),
  ]);
  const who = new Map((seats ?? []).map((s) => [s.user_id, s.name]));

  // The latest edit per code that revert could still undo.
  const ids = (codes ?? []).map((c) => c.id);
  const lastEdit = new Map<string, CodeRow["lastEdit"]>();
  if (ids.length) {
    const { data: edits } = await supabase
      .from("edit")
      .select("object_id,text,edited_by,edited_at")
      .eq("object_type", "code")
      .eq("reverted", false)
      .not("before", "is", null)
      .not("after", "is", null)
      .in("object_id", ids)
      .order("edited_at", { ascending: false });
    for (const e of edits ?? []) {
      if (!lastEdit.has(e.object_id)) {
        lastEdit.set(e.object_id, { text: e.text, by: who.get(e.edited_by) ?? "someone", at: e.edited_at });
      }
    }
  }

  return (
    <CodingView
      transcriptId={transcriptId}
      editor={editor}
      lines={lines}
      codes={(codes ?? []).map((c) => ({ ...c, lastEdit: lastEdit.get(c.id) ?? null })) as CodeRow[]}
      rejections={(rejections ?? []) as RejectionRow[]}
      runs={(runs ?? []).map((r) => ({ ...r, started_by: who.get(r.started_by) ?? "someone" })) as RunRow[]}
    />
  );
}
