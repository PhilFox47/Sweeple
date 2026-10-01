import { db, getSetting, setSetting } from "./db.js";
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

const MODEL_SETTING = "nanogpt_model";

/** Picked in Settings, else NANOGPT_MODEL from .env. The UI choice wins so it can be tried out live. */
function model(): string {
  return getSetting(MODEL_SETTING)?.trim() || process.env.NANOGPT_MODEL?.trim() || "";
}

export function setModel(id: string | null): void {
  setSetting(MODEL_SETTING, id?.trim() || null);
}

export function translationConfigured(): boolean {
  return Boolean(apiKey() && model());
}

export interface TranslationStatus {
  configured: boolean;
  /** What is missing, so Settings can say exactly that. The key only ever comes from .env. */
  missing: ("NANOGPT_API_KEY" | "model")[];
  model: string | null;
  running: boolean;
  /** Whether the current run is re-translating everything rather than filling gaps. */
  retranslating: boolean;
  /** Owned games with English text from BGG at all. */
  withText: number;
  /** Of those, how many show German right now. */
  inGerman: number;
  /** Owned games BGG has given us nothing for yet. */
  withoutText: number;
  done: number;
  /** How many the current run set out to translate. */
  runTotal: number;
  lastError: string | null;
}

let running = false;
let retranslating = false;
let lastError: string | null = null;
let doneThisRun = 0;
let runTotal = 0;

interface Row extends BlurbFields {
  id: number;
  name: string;
  summary_model: string | null;
}

function ownedRows(): Row[] {
  return db
    .prepare(
      `SELECT id, name, short_description, description, summary, summary_source, summary_from, summary_model
       FROM games WHERE owned = 1 ORDER BY name COLLATE NOCASE`
    )
    .all() as Row[];
}

/**
 * English that needs a German version: missing or stale, or — with `all` — every machine
 * translation, to redo them with another model. Hand-written German is never in the list. The
 * English is always BGG's original, never the earlier German.
 */
function toTranslate(rows: Row[], all = false): { row: Row; english: string }[] {
  return rows.flatMap((row) => {
    if (row.summary_source === "manual") return [];
    const english = englishBlurb(row);
    if (!english) return [];
    if (!all && row.summary && row.summary_from === english) return [];
    return [{ row, english }];
  });
}

export function translationStatus(): TranslationStatus {
  const rows = ownedRows();
  const pending = toTranslate(rows).length;
  const withText = rows.filter((r) => englishBlurb(r) || r.summary_source === "manual").length;
  const missing: TranslationStatus["missing"] = [];
  if (!apiKey()) missing.push("NANOGPT_API_KEY");
  if (!model()) missing.push("model");
  return {
    configured: missing.length === 0,
    missing,
    model: model() || null,
    running,
    retranslating,
    withText,
    inGerman: withText - pending,
    withoutText: rows.length - withText,
    done: doneThisRun,
    runTotal,
    lastError,
  };
}

/** Raised for answers that will fail the same way for every game, so the run stops. */
class FatalTranslationError extends Error {}

async function translate(english: string, modelId = model()): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
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
    throw new FatalTranslationError(`Nano-GPT lehnt die Anfrage ab (${res.status}) — gibt es das Modell „${modelId}“? ${body}`);
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
 * Translates everything that needs it — or, with `all`, every machine translation again. A no-op
 * without configuration or while already running, so it is simply called after every sync and
 * import. Old translations stay on the cards until their replacement arrives.
 */
export async function translateMissing({ all = false }: { all?: boolean } = {}): Promise<void> {
  if (running || !translationConfigured()) return;
  running = true;
  retranslating = all;
  lastError = null;
  doneThisRun = 0;
  const modelId = model();

  try {
    const queue = toTranslate(ownedRows(), all);
    runTotal = queue.length;
    // A hand-written summary saved while this was running wins.
    const save = db.prepare(
      `UPDATE games SET summary = ?, summary_source = 'ai', summary_from = ?, summary_model = ?
       WHERE id = ? AND (summary_source IS NULL OR summary_source = 'ai')`
    );

    async function worker() {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const german = await translate(item.english, modelId);
          if (german) {
            save.run(german, item.english, modelId, item.row.id);
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
    retranslating = false;
    if (doneThisRun > 0) broadcast({ type: "library-changed" });
  }
}

/** Hand-written German, or null to clear it so BGG's text (or its translation) shows again. */
export function setManualSummary(gameId: number, summary: string | null): boolean {
  const text = summary?.trim() || null;
  return (
    db
      .prepare("UPDATE games SET summary = ?, summary_source = ?, summary_from = NULL, summary_model = NULL WHERE id = ?")
      .run(text, text ? "manual" : null, gameId).changes > 0
  );
}

export interface ModelInfo {
  id: string;
  name: string | null;
}

let modelCache: { at: number; models: ModelInfo[] } | null = null;
const MODEL_CACHE_MS = 10 * 60 * 1000;

/**
 * What Nano-GPT offers, from its OpenAI-style model list. Cached briefly: the list is long and
 * changes rarely, and Settings asks for it every time it opens.
 */
export async function listModels(): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.models;
  const res = await fetch(`${BASE_URL}/models`, {
    headers: apiKey() ? { Authorization: `Bearer ${apiKey()}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nano-GPT liefert keine Modellliste (${res.status}).`);
  const data = (await res.json()) as { data?: { id?: unknown; name?: unknown }[] };
  const models = (data.data ?? [])
    .filter((m): m is { id: string; name?: unknown } => typeof m.id === "string" && m.id.length > 0)
    .map((m) => ({ id: m.id, name: typeof m.name === "string" && m.name !== m.id ? m.name : null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  modelCache = { at: Date.now(), models };
  return models;
}

export interface Sample {
  name: string;
  english: string;
  current: string | null;
  candidate: string | null;
}

/**
 * A few texts translated with a model, without saving anything: the cheap way to judge a model
 * before re-translating the whole library with it. Always the same texts — the longest, which
 * show the difference best — so one model can be compared against another on equal terms.
 */
export async function sampleTranslations(modelId: string, count = 3): Promise<Sample[]> {
  if (!apiKey()) throw new Error("Für Übersetzungen fehlt NANOGPT_API_KEY in der .env.");
  const picks = toTranslate(ownedRows(), true)
    .sort((a, b) => b.english.length - a.english.length)
    .slice(0, count);
  const samples: Sample[] = [];
  for (const { row, english } of picks) {
    const candidate = await translate(english, modelId).catch((err) => {
      throw err instanceof FatalTranslationError ? new Error(err.message) : err;
    });
    samples.push({
      name: row.name,
      english,
      current: row.summary_source === "ai" && row.summary_from === english ? row.summary : null,
      candidate,
    });
  }
  return samples;
}
