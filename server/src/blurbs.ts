/**
 * Which text a card shows. BGG supplies English; a German version replaces it when there is one
 * that still matches. Pure, so the deck, the library and the translator all agree.
 */

export interface BlurbFields {
  short_description: string | null;
  description: string | null;
  summary: string | null;
  summary_source: string | null;
  summary_from: string | null;
}

/** Long enough for two sentences; short enough to stay a blurb rather than the rules. */
const OPENING_LIMIT = 280;

/**
 * BGG's one-liner when it has one. Otherwise the opening of the long description — the first
 * sentence or two, which on BGG nearly always says what the game is.
 */
export function englishBlurb(game: Pick<BlurbFields, "short_description" | "description">): string | null {
  if (game.short_description?.trim()) return game.short_description.trim();
  const description = game.description?.trim();
  if (!description) return null;

  const firstParagraph = description.split("\n").find((p) => p.trim()) ?? description;
  const sentences = firstParagraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [firstParagraph];
  let text = "";
  for (const sentence of sentences) {
    if (text && (text + sentence).length > OPENING_LIMIT) break;
    text += sentence;
    if (text.length > OPENING_LIMIT / 2) break;
  }
  text = text.trim();
  return text.length > OPENING_LIMIT ? `${text.slice(0, OPENING_LIMIT - 1).trimEnd()}…` : text || null;
}

/**
 * Hand-written German always wins. A translation counts only while it is a translation of the
 * English that is current; otherwise the English shows until it is translated again.
 */
export function displayBlurb(game: BlurbFields): { text: string | null; language: "de" | "en" | null } {
  if (game.summary && game.summary_source === "manual") return { text: game.summary, language: "de" };
  const english = englishBlurb(game);
  if (game.summary && game.summary_source === "ai" && game.summary_from === english) {
    return { text: game.summary, language: "de" };
  }
  return { text: english, language: english ? "en" : null };
}
