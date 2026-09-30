import { loadDeck } from "@/lib/deck/load";
import { quoteRoles } from "@/lib/people/roles";
import { createClient } from "@/lib/supabase/server";
import { DeckView } from "./DeckView";

/** Loads the Deck view: the project's deck templates, the chosen one's deck
 *  and slides, what they can cite, and the title of whoever said each quote
 *  (quotes are attributed by role, never by name). */
export async function DeckStage({ projectId, templateId, editor }: { projectId: string; templateId: string | undefined; editor: boolean }) {
  const supabase = await createClient();
  const [deck, roleOf] = await Promise.all([loadDeck(supabase, projectId, templateId), quoteRoles(supabase, projectId)]);
  if (!deck) return null;
  const roles = Object.fromEntries(roleOf);
  return <DeckView projectId={projectId} editor={editor} deck={deck} roles={roles} />;
}
