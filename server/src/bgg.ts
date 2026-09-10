import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const BASE = "https://boardgamegeek.com/xmlapi2";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, maxAttempts = 8): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url);
    if (res.status === 202) {
      // BGG queued the export; wait and retry.
      await sleep(1500 * attempt);
      continue;
    }
    if (res.status === 429) {
      await sleep(2000 * attempt);
      continue;
    }
    if (!res.ok) {
      throw new Error(`BGG request failed (${res.status}): ${url}`);
    }
    return res.text();
  }
  throw new Error(`BGG request kept returning 202/429 after ${maxAttempts} attempts: ${url}`);
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
}

export async function fetchCollection(username: string): Promise<CollectionItem[]> {
  const url = `${BASE}/collection?username=${encodeURIComponent(username)}&own=1&excludesubtype=boardgameexpansion&stats=0`;
  const expansionsUrl = `${BASE}/collection?username=${encodeURIComponent(username)}&own=1&subtype=boardgameexpansion&stats=0`;

  const [baseXml, expansionXml] = await Promise.all([fetchWithRetry(url), fetchWithRetry(expansionsUrl)]);

  const parseItems = (xml: string, isExpansion: boolean): CollectionItem[] => {
    const doc = parser.parse(xml);
    const items = toArray(doc?.items?.item);
    return items.map((item: any) => ({
      bggId: Number(item["@_objectid"]),
      name: typeof item.name === "object" ? item.name["#text"] ?? item.name : item.name,
      yearPublished: item.yearpublished !== undefined ? Number(item.yearpublished) : null,
      thumbnail: item.thumbnail ?? null,
      image: item.image ?? null,
      isExpansion,
    }));
  };

  return [...parseItems(baseXml, false), ...parseItems(expansionXml, true)];
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
}

export async function fetchGameDetails(bggIds: number[]): Promise<GameDetails[]> {
  const results: GameDetails[] = [];
  const chunkSize = 20;
  for (let i = 0; i < bggIds.length; i += chunkSize) {
    const chunk = bggIds.slice(i, i + chunkSize);
    const url = `${BASE}/thing?id=${chunk.join(",")}&stats=1`;
    const xml = await fetchWithRetry(url);
    const doc = parser.parse(xml);
    const items = toArray(doc?.items?.item);

    for (const item of items) {
      const names = toArray(item.name);
      const primaryName = names.find((n: any) => n["@_type"] === "primary")?.["@_value"] ?? names[0]?.["@_value"] ?? "Unknown";
      const links = toArray(item.link);
      const categories = links.filter((l: any) => l["@_type"] === "boardgamecategory").map((l: any) => l["@_value"]);
      const mechanics = links.filter((l: any) => l["@_type"] === "boardgamemechanic").map((l: any) => l["@_value"]);
      const stats = item.statistics?.ratings;
      const rank = toArray(stats?.ranks?.rank).find((r: any) => r["@_name"] === "boardgame");

      results.push({
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
      });
    }
    // Be polite to BGG's API between chunks.
    if (i + chunkSize < bggIds.length) await sleep(1000);
  }
  return results;
}

export interface PlayStats {
  bggId: number;
  numPlays: number;
  lastPlayedAt: string | null;
}

export async function fetchPlayStats(username: string): Promise<Map<number, PlayStats>> {
  const stats = new Map<number, PlayStats>();
  let page = 1;
  for (;;) {
    const url = `${BASE}/plays?username=${encodeURIComponent(username)}&page=${page}`;
    const xml = await fetchWithRetry(url);
    const doc = parser.parse(xml);
    const plays = toArray(doc?.plays?.play);
    if (plays.length === 0) break;

    for (const play of plays) {
      const bggId = Number(play.item?.["@_objectid"]);
      if (!bggId) continue;
      const date: string = play["@_date"];
      const existing = stats.get(bggId);
      if (existing) {
        existing.numPlays += 1;
        if (!existing.lastPlayedAt || date > existing.lastPlayedAt) existing.lastPlayedAt = date;
      } else {
        stats.set(bggId, { bggId, numPlays: 1, lastPlayedAt: date });
      }
    }

    const total = Number(doc?.plays?.["@_total"] ?? 0);
    if (page * 100 >= total) break;
    page += 1;
    await sleep(500);
  }
  return stats;
}
