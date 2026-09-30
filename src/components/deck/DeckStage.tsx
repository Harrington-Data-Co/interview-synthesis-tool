import { loadDeck } from "@/lib/deck/load";
import { createClient } from "@/lib/supabase/server";
import { DeckView } from "./DeckView";

/** Loads the Deck view: the project's deck templates, the chosen one's deck
 *  and slides, what they can cite, and each interviewee's role (quotes are
 *  attributed by role, never by name). */
export async function DeckStage({ projectId, templateId, editor }: { projectId: string; templateId: string | undefined; editor: boolean }) {
  const supabase = await createClient();
  const [deck, { data: people }] = await Promise.all([
    loadDeck(supabase, projectId, templateId),
    supabase.from("transcript").select("id,participant_role").eq("project_id", projectId),
  ]);
  if (!deck) return null;
  const roles = Object.fromEntries((people ?? []).map((p) => [p.id, p.participant_role as string | null]));
  return <DeckView projectId={projectId} editor={editor} deck={deck} roles={roles} />;
}
