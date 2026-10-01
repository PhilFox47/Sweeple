import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";
import { broadcast } from "./ws.js";

/**
 * Short German summaries for the swipe card: what kind of game it is and what you actually do,
 * for someone who has never played it. Written by Claude from BGG's own description, cached in
 * the database, and only ever generated once per game — a hand-written summary always wins.
 */

const MODEL = "claude-opus-5-5";

/** Small and steady: a household library is tens of games, and BGG data rarely changes. */
const CONCURRENCY = 3;

const SYSTEM = `Du schreibst Kurzbeschreibungen von Brettspielen für eine App, mit der eine Spielgruppe abends auswählt, was sie spielt.

Schreibe genau zwei bis drei Sätze auf Deutsch, für jemanden, der das Spiel noch nie gespielt hat:
- Was für ein Spiel ist es, und was macht man darin eigentlich?
- Wie fühlt es sich an — gegeneinander oder miteinander, locker oder verkopft, schnell oder abendfüllend?

Stütze dich auf die mitgelieferte Beschreibung von BoardGameGeek. Erfinde keine Details, die dort nicht stehen; wenn die Beschreibung dünn ist, bleib allgemein. Keine Werbesprache, keine Regeldetails, keine Spielerzahl oder Spieldauer als bloße Zahlen — die stehen schon auf der Karte. Antworte nur mit den Sätzen selbst, ohne Überschrift und ohne Anführungszeichen.`;

interface GameRow {
  id: number;
  name: string;
  year_published: number | null;
  description: string | null;
  categories: string;
  mechanics: string;
  weight: number | null;
  is_expansion: number;
}

export interface SummaryStatus {
  /** Whether the server has an API key at all. Without one the feature is hand-written only. */
  configured: boolean;
  running: boolean;
  /** Owned games that still have no summary. */
  missing: number;
  /** Of those, how many have a BGG description to write from. */
  missingWithDescription: number;
  done: number;
  lastError: string | null;
}

let running = false;
let lastError: string | null = null;
let doneThisRun = 0;

/** The SDK also reads auth tokens and profiles, but in a container the environment is the source. */
export function summariesConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function summaryStatus(): SummaryStatus {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS missing,
              SUM(CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END) AS withDescription
       FROM games WHERE owned = 1 AND summary IS NULL`
    )
    .get() as { missing: number; withDescription: number | null };
  return {
    configured: summariesConfigured(),
    running,
    missing: counts.missing,
    missingWithDescription: counts.withDescription ?? 0,
    done: doneThisRun,
    lastError,
  };
}

function promptFor(game: GameRow): string {
  const facts = [
    `Spiel: ${game.name}${game.year_published ? ` (${game.year_published})` : ""}`,
    game.is_expansion ? "Hinweis: laut BGG eine Erweiterung." : null,
    game.weight !== null ? `Komplexität laut BGG: ${game.weight.toFixed(1)} von 5` : null,
    `Kategorien: ${(JSON.parse(game.categories) as string[]).join(", ") || "—"}`,
    `Mechaniken: ${(JSON.parse(game.mechanics) as string[]).join(", ") || "—"}`,
  ].filter(Boolean);
  return `${facts.join("\n")}\n\nBeschreibung von BoardGameGeek:\n${game.description ?? "(keine)"}`;
}

/** One summary, or null when the model declined or ran out of room — the game just stays blank. */
async function summarize(client: Anthropic, game: GameRow): Promise<string | null> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // A short summary of text it is given: low effort is plenty and keeps a library run cheap.
    output_config: { effort: "low" },
    // On a policy decline, let the API retry on its recommended fallback rather than leave a gap.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: promptFor(game) }],
  });

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    console.warn(`[summaries] no summary for "${game.name}": ${response.stop_reason}`);
    return null;
  }
  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  return text || null;
}

/**
 * Fills in every owned game that has no summary yet and a BGG description to write from. Safe to
 * call repeatedly — a second call while one is running is a no-op — so it is simply kicked off
 * after every sync and import.
 */
export async function generateMissingSummaries(): Promise<void> {
  if (running || !summariesConfigured()) return;
  running = true;
  lastError = null;
  doneThisRun = 0;

  try {
    const client = new Anthropic();
    const queue = db
      .prepare(
        `SELECT id, name, year_published, description, categories, mechanics, weight, is_expansion
         FROM games
         WHERE owned = 1 AND summary IS NULL AND description IS NOT NULL
         ORDER BY name COLLATE NOCASE`
      )
      .all() as GameRow[];

    const save = db.prepare(
      // The guard matters: a hand-written summary saved while this one was being generated wins.
      "UPDATE games SET summary = ?, summary_source = 'ai' WHERE id = ? AND summary IS NULL"
    );

    async function worker() {
      for (let game = queue.shift(); game; game = queue.shift()) {
        try {
          const summary = await summarize(client, game);
          if (summary) {
            save.run(summary, game.id);
            doneThisRun += 1;
          }
        } catch (err) {
          // Auth and rate limits will fail every remaining game the same way; stop rather than
          // burning through the queue. Anything else is this one game's problem.
          if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
            lastError = "Der API-Schlüssel wurde abgelehnt.";
            queue.length = 0;
          } else if (err instanceof Anthropic.RateLimitError) {
            lastError = "Zu viele Anfragen auf einmal — später noch einmal versuchen.";
            queue.length = 0;
          } else if (err instanceof Anthropic.APIError) {
            lastError = `Fehler der Claude-API (${err.status ?? "?"}) bei „${game.name}“.`;
          } else {
            lastError = `Keine Verbindung zur Claude-API (${err instanceof Error ? err.message : "unbekannt"}).`;
            queue.length = 0;
          }
          console.error(`[summaries] ${game.name}:`, err);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    running = false;
    // Cards dealt from now on carry the new summaries.
    if (doneThisRun > 0) broadcast({ type: "library-changed" });
  }
}

/** A hand-written summary, or null to clear it so the generator may write one again. */
export function setManualSummary(gameId: number, summary: string | null): boolean {
  const text = summary?.trim() || null;
  return (
    db
      .prepare("UPDATE games SET summary = ?, summary_source = ? WHERE id = ?")
      .run(text, text ? "manual" : null, gameId).changes > 0
  );
}
