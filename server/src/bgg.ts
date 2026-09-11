import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
export const BGG_ORIGIN = process.env.BGG_ORIGIN ?? "https://boardgamegeek.com";
const BASE = `${BGG_ORIGIN}/xmlapi2`;

export interface BggRequestOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

// BGG prepares a collection export in the background and serves it on a later request, so
// polling steadily beats backing off aggressively — which BGG answers with 401/403.
const POLL_INTERVAL_MS = 5000;
// A safety net for the weekly unattended sync; interactive syncs are ended with the stop button.
const MAX_WAIT_MS = 30 * 60 * 1000;

class SyncCancelledError extends Error {
  constructor() {
    super("Sync stopped");
    this.name = "SyncCancelledError";
  }
}

export function isCancellation(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "SyncCancelledError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new SyncCancelledError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new SyncCancelledError());
      },
      { once: true }
    );
  });
}

// Node's fetch sends "User-Agent: node", which BGG's bot filtering rejects outright.
// The same URLs succeed from a browser, so present as one.
// Cloudflare binds cf_clearance to the exact User-Agent that obtained it, so when a cookie is
// copied from a browser this must be set to that same browser's User-Agent or the cookie is void.
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": DEFAULT_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "sec-ch-ua": '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export function configuredToken(): string {
  return process.env.BGG_TOKEN?.trim() ?? "";
}

/**
 * BGG requires a registered application token on nearly every XML API endpoint; the sole
 * exemption is downloading your own collection while logged in to the site, which is why a
 * collection URL works in a browser but /thing answers `WWW-Authenticate: Bearer realm="xml api"`.
 * Per the API docs the header is exactly `Bearer`, one space, the token — no colon.
 */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = configuredToken();
  if (token) headers.Authorization = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  const userAgent = process.env.BGG_USER_AGENT?.trim();
  if (userAgent) headers["User-Agent"] = userAgent;
  return headers;
}

export function configuredCookie(): string {
  return process.env.BGG_COOKIE?.trim() ?? "";
}

export function hasBggCredentials(): boolean {
  return Boolean(process.env.BGG_TOKEN?.trim() || configuredCookie());
}

// The most likely way a copied cookie silently fails.
export function credentialWarning(): string | null {
  const cookie = configuredCookie();
  if (cookie.includes("cf_clearance") && !process.env.BGG_USER_AGENT?.trim()) {
    return (
      "BGG_COOKIE contains cf_clearance but BGG_USER_AGENT is not set. Cloudflare ties that " +
      "cookie to the browser that obtained it, so copy your browser's User-Agent into " +
      "BGG_USER_AGENT (run `navigator.userAgent` in the browser console) or the cookie is ignored."
    );
  }
  return null;
}

// Bot filtering and network middleboxes both answer with terse status codes, so record what
// actually came back. Which one it is decides the fix, and it is only visible in the container.
function logRejection(url: string, res: { status: number; header: (n: string) => string | null }, body: string) {
  const interesting = ["server", "content-type", "cf-ray", "cf-mitigated", "set-cookie", "www-authenticate", "via", "x-cache"];
  const headers = interesting
    .map((h) => (res.header(h) ? `${h}: ${res.header(h)}` : null))
    .filter(Boolean)
    .join(" | ");
  console.warn(
    `[bgg] HTTP ${res.status} from ${url}\n` +
      `[bgg] headers: ${headers || "(none of interest)"}\n` +
      `[bgg] body: ${body.replace(/\s+/g, " ").trim().slice(0, 400) || "(empty)"}`
  );
}

// BGG announces a queued export as a <message> body — sometimes with 202, but also with a
// plain 200. Treated as success it parses to zero items and silently wipes the collection.
function isQueuedBody(xml: string): boolean {
  return /<message>/i.test(xml) && /(accepted|being processed|will be processed|try again)/i.test(xml);
}

interface Fetched {
  status: number;
  body: string;
  header: (name: string) => string | null;
}

// "auto" starts on plain HTTP and switches to the browser the moment BGG demands credentials,
// which is both cheaper when HTTP works and self-healing when it does not.
type FetchMode = "auto" | "http" | "browser";
const FETCH_MODE = (process.env.BGG_FETCH_MODE as FetchMode) || "auto";
let useBrowser = FETCH_MODE === "browser";

async function httpFetch(url: string, cookie: string, signal?: AbortSignal): Promise<Fetched> {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...authHeaders(), ...(cookie ? { Cookie: cookie } : {}) },
    redirect: "follow",
    signal,
  });
  return { status: res.status, body: await res.text(), header: (n) => res.headers.get(n) };
}

async function browserFetch(url: string): Promise<Fetched> {
  const { fetchViaBrowser } = await import("./browser.js");
  const res = await fetchViaBrowser(url);
  return { status: res.status, body: res.body, header: (n) => res.headers[n.toLowerCase()] ?? null };
}

async function fetchWithRetry(url: string, label: string, options: BggRequestOptions = {}): Promise<string> {
  const { signal, onProgress } = options;
  const deadline = Date.now() + MAX_WAIT_MS;
  // BGG hands out a session cookie with the queued export and expects it back, exactly as a
  // browser reload would return it. Seeded with any cookie the operator supplied.
  let cookie = configuredCookie();

  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new SyncCancelledError();

    const res = useBrowser ? await browserFetch(url) : await httpFetch(url, cookie, signal);

    const setCookie = res.header("set-cookie");
    if (setCookie) {
      const jar = setCookie
        .split(/,(?=[^;]+?=)/)
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean);
      if (jar.length) cookie = [cookie, ...jar].filter(Boolean).join("; ");
    }

    let waitReason: string | null = null;

    if (res.status >= 200 && res.status < 300) {
      if (!isQueuedBody(res.body)) return res.body;
      waitReason = `BGG is preparing the ${label}`;
    } else if (res.status === 429 || res.status === 401 || res.status === 403 || res.status >= 500) {
      // Log the first one and then occasionally, so a persistent block is visible in the logs.
      if (attempt === 1 || attempt % 6 === 0) logRejection(url, res, res.body);

      // An explicit auth challenge is a statement, not a queue — retrying it never succeeds.
      // Cloudflare ties clearance to the TLS fingerprint, so no header or cookie fixes this
      // from Node; a real browser can, and in "auto" mode that is what we switch to.
      const challenge = res.header("www-authenticate");
      if (challenge && (res.status === 401 || res.status === 403)) {
        // With a token configured this is BGG rejecting that token, so escalating to a browser
        // would only hide the real problem behind a slower failure.
        if (configuredToken()) {
          throw new Error(
            `BGG rejected the API token on the ${label} request (HTTP ${res.status}, ${challenge}). ` +
              "Check BGG_TOKEN against https://boardgamegeek.com/applications — the token must belong " +
              "to an approved application and be sent to boardgamegeek.com without a leading www."
          );
        }
        if (!useBrowser && FETCH_MODE === "auto") {
          useBrowser = true;
          onProgress?.("BGG demanded credentials — switching to the built-in browser");
          console.warn(`[bgg] ${res.status} ${challenge} over plain HTTP; retrying via Chromium.`);
          continue;
        }
        throw new Error(
          `BGG requires an API token for the ${label} request (HTTP ${res.status}, ${challenge}). ` +
            "Register an application at https://boardgamegeek.com/applications, create a token, " +
            "and set BGG_TOKEN in your .env."
        );
      }

      waitReason = `BGG is throttling the ${label} request (HTTP ${res.status})`;
    } else {
      logRejection(url, res, res.body);
      const body = res.body.replace(/\s+/g, " ").trim().slice(0, 300);
      throw new Error(`BGG request failed (${res.status}) for ${url}.${body ? ` BGG said: ${body}` : ""}`);
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Gave up after ${Math.round(MAX_WAIT_MS / 60000)} minutes waiting for BGG to return the ${label}. ` +
          `Last state: ${waitReason}.`
      );
    }

    onProgress?.(`${waitReason} — retrying every ${POLL_INTERVAL_MS / 1000}s (attempt ${attempt})`);
    await sleep(POLL_INTERVAL_MS, signal);
  }
}

// BGG reports some failures (e.g. an unknown username) as HTTP 200 with an <errors> body.
function assertNoXmlError(xml: string, context: string) {
  const match = xml.match(/<error>[\s\S]*?<message>([\s\S]*?)<\/message>/i);
  if (match) throw new Error(`BGG rejected the ${context} request: ${match[1].trim()}`);
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export interface CollectionItem {
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnail: string | null;
  image: string | null;
  isExpansion: boolean;
  numPlays: number;
}

export function parseCollectionXml(xml: string): CollectionItem[] {
  assertNoXmlError(xml, "collection");
  const doc = parser.parse(xml);
  if (!doc?.items) throw new Error("That does not look like a BGG collection response.");

  return toArray(doc.items.item).map((item: any) => ({
    bggId: Number(item["@_objectid"]),
    name: typeof item.name === "object" ? item.name["#text"] ?? item.name : String(item.name),
    yearPublished: item.yearpublished !== undefined ? Number(item.yearpublished) : null,
    thumbnail: item.thumbnail ?? null,
    image: item.image ?? null,
    // Collections report expansions as subtype "boardgame" too, so this is only a hint;
    // the thing endpoint is authoritative and corrects it when details are imported.
    isExpansion: item["@_subtype"] === "boardgameexpansion",
    numPlays: item.numplays !== undefined ? Number(item.numplays) : 0,
  }));
}

export async function fetchCollection(
  username: string,
  options: BggRequestOptions = {}
): Promise<CollectionItem[]> {
  // One request for the whole collection. BGG queues collection exports per user, so asking
  // twice at once (games and expansions separately) makes it reject one of them.
  const xml = await fetchWithRetry(
    `${BASE}/collection?username=${encodeURIComponent(username)}&own=1`,
    "collection",
    options
  );
  return parseCollectionXml(xml);
}

export function collectionUrl(username: string): string {
  return `${BASE}/collection?username=${encodeURIComponent(username)}&own=1`;
}

export function thingUrl(bggIds: number[]): string {
  return `${BASE}/thing?id=${bggIds.join(",")}&stats=1`;
}

export interface GameDetails {
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnail: string | null;
  image: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
  playingTime: number | null;
  weight: number | null;
  averageRating: number | null;
  bggRank: number | null;
  categories: string[];
  mechanics: string[];
  isExpansion: boolean;
  bestPlayers: number[];
  recommendedPlayers: number[];
}

/**
 * BGG's "suggested_numplayers" poll, where voters rate each player count Best / Recommended /
 * Not Recommended. A count is "best" when Best wins the vote outright, otherwise "recommended"
 * if Recommended beats Not Recommended.
 *
 * The poll also carries an entry like numplayers="6+" meaning "more than the maximum"; parsing
 * that as 6 would collide with a real 6-player entry, so those are skipped.
 */
function parseSuggestedPlayers(item: any): { best: number[]; recommended: number[] } {
  const poll = toArray(item.poll).find((p: any) => p["@_name"] === "suggested_numplayers");
  const best: number[] = [];
  const recommended: number[] = [];
  if (!poll) return { best, recommended };

  for (const results of toArray((poll as any).results)) {
    const label = String((results as any)["@_numplayers"] ?? "");
    if (label.includes("+")) continue;
    const count = Number.parseInt(label, 10);
    if (!Number.isFinite(count)) continue;

    const votes: Record<string, number> = {};
    for (const r of toArray((results as any).result)) {
      votes[String((r as any)["@_value"])] = Number((r as any)["@_numvotes"] ?? 0);
    }
    const b = votes.Best ?? 0;
    const rec = votes.Recommended ?? 0;
    const no = votes["Not Recommended"] ?? 0;

    if (b > 0 && b >= rec && b >= no) best.push(count);
    else if (rec > 0 && rec >= no) recommended.push(count);
  }
  return { best, recommended };
}

export function parseThingXml(xml: string): GameDetails[] {
  assertNoXmlError(xml, "game details");
  const doc = parser.parse(xml);
  if (!doc?.items) throw new Error("That does not look like a BGG thing (game details) response.");

  return toArray(doc.items.item).map((item: any) => {
    const names = toArray(item.name);
    const primaryName = names.find((n: any) => n["@_type"] === "primary")?.["@_value"] ?? names[0]?.["@_value"] ?? "Unknown";
    const links = toArray(item.link);
    const categories = links.filter((l: any) => l["@_type"] === "boardgamecategory").map((l: any) => l["@_value"]);
    const mechanics = links.filter((l: any) => l["@_type"] === "boardgamemechanic").map((l: any) => l["@_value"]);
    const stats = item.statistics?.ratings;
    const rank = toArray(stats?.ranks?.rank).find((r: any) => r["@_name"] === "boardgame");
    const suggested = parseSuggestedPlayers(item);

    return {
      bggId: Number(item["@_id"]),
      name: primaryName,
      yearPublished: item.yearpublished?.["@_value"] !== undefined ? Number(item.yearpublished["@_value"]) : null,
      thumbnail: item.thumbnail ?? null,
      image: item.image ?? null,
      minPlayers: item.minplayers?.["@_value"] !== undefined ? Number(item.minplayers["@_value"]) : null,
      maxPlayers: item.maxplayers?.["@_value"] !== undefined ? Number(item.maxplayers["@_value"]) : null,
      minPlaytime: item.minplaytime?.["@_value"] !== undefined ? Number(item.minplaytime["@_value"]) : null,
      maxPlaytime: item.maxplaytime?.["@_value"] !== undefined ? Number(item.maxplaytime["@_value"]) : null,
      playingTime: item.playingtime?.["@_value"] !== undefined ? Number(item.playingtime["@_value"]) : null,
      weight: stats?.averageweight?.["@_value"] !== undefined ? Number(stats.averageweight["@_value"]) : null,
      averageRating: stats?.average?.["@_value"] !== undefined ? Number(stats.average["@_value"]) : null,
      bggRank: rank && rank["@_value"] !== "Not Ranked" ? Number(rank["@_value"]) : null,
      categories,
      mechanics,
      // Only the thing endpoint distinguishes these; a collection lists expansions as "boardgame".
      isExpansion: item["@_type"] === "boardgameexpansion",
      bestPlayers: suggested.best,
      recommendedPlayers: suggested.recommended,
    };
  });
}

export async function fetchGameDetails(
  bggIds: number[],
  options: BggRequestOptions = {}
): Promise<GameDetails[]> {
  const results: GameDetails[] = [];
  const chunkSize = 20;
  const totalChunks = Math.ceil(bggIds.length / chunkSize);
  for (let i = 0; i < bggIds.length; i += chunkSize) {
    const chunk = bggIds.slice(i, i + chunkSize);
    options.onProgress?.(`Fetching game details ${Math.floor(i / chunkSize) + 1}/${totalChunks}`);
    const xml = await fetchWithRetry(thingUrl(chunk), "game details", options);
    results.push(...parseThingXml(xml));
    // Be polite to BGG's API between chunks.
    if (i + chunkSize < bggIds.length) await sleep(1500, options.signal);
  }
  return results;
}

export interface PlayStats {
  bggId: number;
  numPlays: number;
  lastPlayedAt: string | null;
}

/** Aggregates one page of play records. Callers merge pages via `mergePlayStats`. */
export function parsePlaysXml(xml: string, into = new Map<number, PlayStats>()): Map<number, PlayStats> {
  assertNoXmlError(xml, "play history");
  const doc = parser.parse(xml);
  if (!doc?.plays) throw new Error("That does not look like a BGG plays response.");

  for (const play of toArray(doc.plays.play)) {
    const bggId = Number((play as any).item?.["@_objectid"]);
    if (!bggId) continue;
    const date: string = (play as any)["@_date"];
    const quantity = Number((play as any)["@_quantity"] ?? 1) || 1;
    const existing = into.get(bggId);
    if (existing) {
      existing.numPlays += quantity;
      if (!existing.lastPlayedAt || date > existing.lastPlayedAt) existing.lastPlayedAt = date;
    } else {
      into.set(bggId, { bggId, numPlays: quantity, lastPlayedAt: date });
    }
  }
  return into;
}

export async function fetchPlayStats(
  username: string,
  options: BggRequestOptions = {}
): Promise<Map<number, PlayStats>> {
  const stats = new Map<number, PlayStats>();
  let page = 1;
  for (;;) {
    const url = `${BASE}/plays?username=${encodeURIComponent(username)}&page=${page}`;
    options.onProgress?.(`Fetching play history (page ${page})`);
    const xml = await fetchWithRetry(url, "play history", options);
    const doc = parser.parse(xml);
    const plays = toArray(doc?.plays?.play);
    if (plays.length === 0) break;
    parsePlaysXml(xml, stats);

    const total = Number(doc?.plays?.["@_total"] ?? 0);
    if (page * 100 >= total) break;
    page += 1;
    await sleep(1000, options.signal);
  }
  return stats;
}
