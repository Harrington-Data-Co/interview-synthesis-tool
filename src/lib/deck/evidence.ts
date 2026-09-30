import type { LoadedDeck, SlideView } from "./load";

/** Evidence for a slide's footer: its themes, and how many interviews stand
 *  behind them. */
export function evidenceLine(slide: SlideView, deck: Pick<LoadedDeck, "themes" | "codes">): string {
  const codeOf = new Map(deck.codes.map((c) => [c.id, c]));
  const themes = deck.themes.filter((t) => slide.themeIds.includes(t.id));
  const ivs = new Set([...themes.flatMap((t) => t.codeIds), ...slide.codeIds].map((id) => codeOf.get(id)?.transcriptId).filter(Boolean));
  const refs = themes.map((t) => t.ref);
  return [refs.length ? refs.join(", ") : null, ivs.size ? `${ivs.size} interview${ivs.size === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
}

/** Who said a quote, for a client audience: a role, never a name. */
export const attribution = (role: string | null | undefined) => `— ${role?.trim() || "Participant"}`;
