import { db } from "./db.js";
import { englishBlurb, type BlurbFields } from "./blurbs.js";
import { broadcast } from "./ws.js";

/**
 * German versions of BGG's English blurbs, through Nano-GPT. Optional: without a key and a model
 * the cards simply show BGG's English. Each translation is cached with the English it came from,
 * so it is only redone when BGG's text changes.
 *
 * Nano-GPT speaks the OpenAI chat-completions format. The base URL is configurable so a changed
 * endpoint is an .env edit, not a code change — and so tests can point it at a local mock.
 */
const BASE_URL = (process.env.NANOGPT_BASE_URL ?? "https://nano-gpt.com/api/v1").replace(/\/+$/, "");

/** A short sentence each; a few at a time is plenty and stays well inside any rate limit. */
const CONCURRENCY = 3;
const TIMEOUT_MS = 60_000;

const SYSTEM = `Du übersetzt kurze Beschreibungen von Brettspielen ins Deutsche, für eine App, mit der eine Spielgruppe abends ein Spiel auswählt.

Übersetze sinngemäß und natürlich, nicht Wort für Wort. Spielnamen, Figurennamen und andere Eigennamen bleiben, wie sie sind. Füge nichts hinzu und lass nichts weg. Antworte nur mit der Übersetzung, ohne Anführungszeichen und ohne Kommentar.`;

function apiKey(): string {
  return process.env.NANOGPT_API_KEY?.trim() ?? "";
}

function model(): string {
  return process.env.NANOGPT_MODEL?.trim() ?? "";
}

export function translationConfigured(): boolean {
  return Boolean(apiKey() && model());
}

export interface TranslationStatus {
  configured: boolean;
  /** What is missing from .env, so Settings can say exactly that. */
  missing: ("NANOGPT_API_KEY" | "NANOGPT_MODEL")[];
  model: string | null;
  running: boolean;
  /** Owned games with English text from BGG at all. */
  withText: number;
  /** Of those, how many show German right now. */
  inGerman: number;
  /** Owned games BGG has given us nothing for yet. */
  withoutText: number;
  done: number;
  lastError: string | null;
}

let running = false;
let lastError: string | null = null;
let doneThisRun = 0;

interface Row extends BlurbFields {
  id: number;
  name: string;
}

function ownedRows(): Row[] {
  return db
    .prepare(
      `SELECT id, name, short_description, description, summary, summary_source, summary_from
       FROM games WHERE owned = 1 ORDER BY name COLLATE NOCASE`
    )
    .all() as Row[];
}

/** English that has no current German version and is not covered by a hand-written one. */
function untranslated(rows: Row[]): { row: Row; english: string }[] {
  return rows.flatMap((row) => {
    if (row.summary_source === "manual") return [];
    const english = englishBlurb(row);
    if (!english) return [];
    if (row.summary && row.summary_from === english) return [];
    return [{ row, english }];
  });
}

export function translationStatus(): TranslationStatus {
  const rows = ownedRows();
  const pending = untranslated(rows).length;
  const withText = rows.filter((r) => englishBlurb(r) || r.summary_source === "manual").length;
  const missing: TranslationStatus["missing"] = [];
  if (!apiKey()) missing.push("NANOGPT_API_KEY");
  if (!model()) missing.push("NANOGPT_MODEL");
  return {
    configured: missing.length === 0,
    missing,
    model: model() || null,
    running,
    withText,
    inGerman: withText - pending,
    withoutText: rows.length - withText,
    done: doneThisRun,
    lastError,
  };
}

/** Raised for answers that will fail the same way for every game, so the run stops. */
class FatalTranslationError extends Error {}

async function translate(english: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model(),
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: english },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    throw new FatalTranslationError("Nano-GPT hat den API-Schlüssel abgelehnt.");
  }
  if (res.status === 402) {
    throw new FatalTranslationError("Nano-GPT meldet: kein Guthaben für dieses Modell.");
  }
  if (res.status === 429) {
    throw new FatalTranslationError("Zu viele Anfragen an Nano-GPT — später noch einmal versuchen.");
  }
  if (res.status === 400 || res.status === 404) {
    const body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
    throw new FatalTranslationError(`Nano-GPT lehnt die Anfrage ab (${res.status}) — stimmt NANOGPT_MODEL „${model()}“? ${body}`);
  }
  if (!res.ok) throw new Error(`Nano-GPT antwortet mit ${res.status}.`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content
    // Reasoning models on some providers put their working in the answer.
    ?.replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^["„“]+|["“”]+$/g, "")
    .trim();
  return text || null;
}

/**
 * Translates everything that needs it. A no-op without configuration or while already running,
 * so it is simply called after every sync and import.
 */
export async function translateMissing(): Promise<void> {
  if (running || !translationConfigured()) return;
  running = true;
  lastError = null;
  doneThisRun = 0;

  try {
    const queue = untranslated(ownedRows());
    // Guarded twice: a hand-written summary saved meanwhile wins, and so does a newer original.
    const save = db.prepare(
      `UPDATE games SET summary = ?, summary_source = 'ai', summary_from = ?
       WHERE id = ? AND (summary_source IS NULL OR summary_source = 'ai')`
    );

    async function worker() {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const german = await translate(item.english);
          if (german) {
            save.run(german, item.english, item.row.id);
            doneThisRun += 1;
          }
        } catch (err) {
          if (err instanceof FatalTranslationError) {
            lastError = err.message;
            queue.length = 0;
          } else {
            lastError = `Übersetzung von „${item.row.name}“ fehlgeschlagen: ${err instanceof Error ? err.message : err}`;
          }
          console.error(`[translate] ${item.row.name}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    running = false;
    if (doneThisRun > 0) broadcast({ type: "library-changed" });
  }
}

/** Hand-written German, or null to clear it so BGG's text (or its translation) shows again. */
export function setManualSummary(gameId: number, summary: string | null): boolean {
  const text = summary?.trim() || null;
  return (
    db
      .prepare("UPDATE games SET summary = ?, summary_source = ?, summary_from = NULL WHERE id = ?")
      .run(text, text ? "manual" : null, gameId).changes > 0
  );
}
