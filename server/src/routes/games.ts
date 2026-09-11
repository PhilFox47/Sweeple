import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { authenticate } from "../auth.js";
import { ratingsForUser } from "../stats.js";

interface GameRow {
  id: number;
  bgg_id: number;
  name: string;
  year_published: number | null;
  thumbnail: string | null;
  image: string | null;
  min_players: number | null;
  max_players: number | null;
  min_playtime: number | null;
  max_playtime: number | null;
  playing_time: number | null;
  weight: number | null;
  average_rating: number | null;
  bgg_rank: number | null;
  categories: string;
  mechanics: string;
  best_players: string;
  recommended_players: string;
  expansion_mode: string;
  num_plays: number;
  last_played_at: string | null;
  is_expansion: number;
  owned: number;
}

function serializeGame(row: GameRow) {
  return {
    id: row.id,
    bggId: row.bgg_id,
    name: row.name,
    yearPublished: row.year_published,
    thumbnail: row.thumbnail,
    image: row.image,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    minPlaytime: row.min_playtime,
    maxPlaytime: row.max_playtime,
    playingTime: row.playing_time,
    weight: row.weight,
    averageRating: row.average_rating,
    bggRank: row.bgg_rank,
    categories: JSON.parse(row.categories) as string[],
    mechanics: JSON.parse(row.mechanics) as string[],
    bestPlayers: JSON.parse(row.best_players ?? "[]") as number[],
    recommendedPlayers: JSON.parse(row.recommended_players ?? "[]") as number[],
    numPlays: row.num_plays,
    lastPlayedAt: row.last_played_at,
    isExpansion: !!row.is_expansion,
    expansionMode: (row.expansion_mode ?? "auto") as "auto" | "hidden" | "standalone",
  };
}

/** Hidden by hand: out of the deck whatever the filters say. */
export const NOT_HIDDEN = "expansion_mode <> 'hidden'";

/** Counts as an expansion — BGG's flag, unless it has been marked standalone by hand. */
export const IS_EXPANSION = "(is_expansion = 1 AND expansion_mode <> 'standalone')";

interface GameFilters {
  playerCount?: number;
  weightMin?: number;
  weightMax?: number;
  maxPlaytime?: number;
  categories?: string[];
  mechanics?: string[];
  notPlayedInDays?: number;
  includeExpansions?: boolean;
}

function parseFilters(query: Record<string, unknown>): GameFilters {
  const toNum = (v: unknown) => (v !== undefined && v !== "" ? Number(v) : undefined);
  const toList = (v: unknown) => (typeof v === "string" && v.length > 0 ? v.split(",") : undefined);
  return {
    playerCount: toNum(query.playerCount),
    weightMin: toNum(query.weightMin),
    weightMax: toNum(query.weightMax),
    maxPlaytime: toNum(query.maxPlaytime),
    categories: toList(query.categories),
    mechanics: toList(query.mechanics),
    notPlayedInDays: toNum(query.notPlayedInDays),
    includeExpansions: query.includeExpansions === "true",
  };
}

function buildWhere(filters: GameFilters): { clause: string; params: Record<string, unknown> } {
  const clauses: string[] = ["owned = 1"];
  const params: Record<string, unknown> = {};

  // Hiding a game is a decision about the game itself, so it outranks every filter — including
  // "include expansions", which is only about what BGG thinks a game is.
  clauses.push(NOT_HIDDEN);
  if (!filters.includeExpansions) clauses.push(`NOT ${IS_EXPANSION}`);
  if (filters.playerCount !== undefined) {
    clauses.push("(min_players IS NULL OR min_players <= @playerCount)");
    clauses.push("(max_players IS NULL OR max_players >= @playerCount)");
    params.playerCount = filters.playerCount;
  }
  if (filters.weightMin !== undefined) {
    clauses.push("(weight IS NULL OR weight >= @weightMin)");
    params.weightMin = filters.weightMin;
  }
  if (filters.weightMax !== undefined) {
    clauses.push("(weight IS NULL OR weight <= @weightMax)");
    params.weightMax = filters.weightMax;
  }
  if (filters.maxPlaytime !== undefined) {
    clauses.push("(playing_time IS NULL OR playing_time <= @maxPlaytime)");
    params.maxPlaytime = filters.maxPlaytime;
  }
  if (filters.notPlayedInDays !== undefined) {
    clauses.push("(last_played_at IS NULL OR julianday('now') - julianday(last_played_at) >= @notPlayedInDays)");
    params.notPlayedInDays = filters.notPlayedInDays;
  }
  if (filters.categories && filters.categories.length > 0) {
    const orParts = filters.categories.map((cat, i) => {
      params[`cat${i}`] = `%"${cat}"%`;
      return `categories LIKE @cat${i}`;
    });
    clauses.push(`(${orParts.join(" OR ")})`);
  }
  if (filters.mechanics && filters.mechanics.length > 0) {
    const orParts = filters.mechanics.map((mech, i) => {
      params[`mech${i}`] = `%"${mech}"%`;
      return `mechanics LIKE @mech${i}`;
    });
    clauses.push(`(${orParts.join(" OR ")})`);
  }

  return { clause: clauses.join(" AND "), params };
}

export default async function gamesRoutes(app: FastifyInstance) {
  app.get("/api/games", { preHandler: authenticate }, async (request) => {
    const filters = parseFilters(request.query as Record<string, unknown>);
    const { clause, params } = buildWhere(filters);
    const rows = db.prepare(`SELECT * FROM games WHERE ${clause} ORDER BY name`).all(params) as GameRow[];
    return { games: rows.map(serializeGame) };
  });

  // The swipeable deck: games matching filters that the current user hasn't decided on yet.
  app.get("/api/games/deck", { preHandler: authenticate }, async (request) => {
    const filters = parseFilters(request.query as Record<string, unknown>);
    const { clause, params } = buildWhere(filters);
    const rows = db
      .prepare(
        `SELECT * FROM games
         WHERE ${clause}
           AND id NOT IN (SELECT game_id FROM swipes WHERE user_id = @userId)
         ORDER BY name`
      )
      .all({ ...params, userId: request.user!.id }) as GameRow[];

    // Your own history with each game, so the card can say "you liked this 2 of 3 times".
    // Deliberately only your own: what the others think is the point of the round.
    const mine = ratingsForUser(request.user!.id);
    return {
      games: rows.map((row) => ({ ...serializeGame(row), yourVotes: mine.get(row.id) ?? { likes: 0, total: 0 } })),
    };
  });

  app.get("/api/meta/categories", { preHandler: authenticate }, async () => {
    const rows = db.prepare("SELECT categories FROM games WHERE owned = 1").all() as { categories: string }[];
    const set = new Set<string>();
    for (const row of rows) for (const cat of JSON.parse(row.categories) as string[]) set.add(cat);
    return { categories: [...set].sort() };
  });

  app.get("/api/meta/mechanics", { preHandler: authenticate }, async () => {
    const rows = db.prepare("SELECT mechanics FROM games WHERE owned = 1").all() as { mechanics: string }[];
    const set = new Set<string>();
    for (const row of rows) for (const mech of JSON.parse(row.mechanics) as string[]) set.add(mech);
    return { mechanics: [...set].sort() };
  });
}
