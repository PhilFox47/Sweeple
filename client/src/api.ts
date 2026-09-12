export interface PlayerRating {
  id: number;
  displayName: string;
  likes: number;
  total: number;
}

export interface GameRating {
  likes: number;
  total: number;
  /** 0–1, or null when nobody has voted on this game yet. */
  ratio: number | null;
  byPlayer: PlayerRating[];
}

export interface Game {
  id: number;
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
  bestPlayers: number[];
  recommendedPlayers: number[];
  numPlays: number;
  lastPlayedAt: string | null;
  isExpansion: boolean;
  expansionMode: ExpansionMode;
  /** How the player looking at the card has voted on it before. */
  yourVotes: { likes: number; total: number };
}

export type ExpansionMode = "auto" | "hidden" | "standalone";

export interface LibraryGame {
  id: number;
  name: string;
  thumbnail: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  isExpansion: boolean;
  mode: ExpansionMode;
  /** Set when other owned boxes clearly belong to the same series, e.g. "Disney Villainous". */
  series: string | null;
  /** Whether the deck currently leaves it out, once the override is applied. */
  hidden: boolean;
  rating: GameRating;
}

export interface Match {
  id: number;
  createdAt: string;
  playedAt: string | null;
  gameId: number;
  name: string;
  thumbnail: string | null;
  image: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;
  weight: number | null;
}

export interface ImportLinks {
  username: string;
  hasToken: boolean;
  collectionUrl: string;
  playsUrl: string;
  detailBatches: { url: string; count: number }[];
  gamesTotal: number;
  gamesWithDetails: number;
}

export interface CurrentUser {
  id: number;
  username: string;
  displayName: string;
  role: "core" | "guest";
  isAdmin: boolean;
  avatar: string | null;
}

export interface Player {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  /** Versioned URL of the profile picture, or null when there is none. */
  avatar: string | null;
}

export interface GameStat {
  gameId: number;
  name: string;
  thumbnail: string | null;
  likes: number;
  total: number;
  ratio: number;
  byPlayer: PlayerRating[];
}

export interface Stats {
  players: { id: number; displayName: string }[];
  games: GameStat[];
  summary: { games: number; votes: number; likes: number; ratio: number | null };
}

export interface Round {
  id: number;
  startedAt: string;
  players: { id: number; displayName: string; isAdmin: boolean }[];
  playerCount: number;
}

export interface Filters {
  playerCount?: number;
  weightMin?: number;
  weightMax?: number;
  maxPlaytime?: number;
  categories?: string[];
  mechanics?: string[];
  notPlayedInDays?: number;
  includeExpansions?: boolean;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    // Never let the browser or a reverse proxy answer from cache: a stale /api/matches is
    // indistinguishable from "no new matches", and a reload would be the only way out.
    cache: "no-store",
    // Fastify rejects a JSON content-type with an empty body, so only send it when there is one.
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.playerCount !== undefined) params.set("playerCount", String(filters.playerCount));
  if (filters.weightMin !== undefined) params.set("weightMin", String(filters.weightMin));
  if (filters.weightMax !== undefined) params.set("weightMax", String(filters.weightMax));
  if (filters.maxPlaytime !== undefined) params.set("maxPlaytime", String(filters.maxPlaytime));
  if (filters.notPlayedInDays !== undefined) params.set("notPlayedInDays", String(filters.notPlayedInDays));
  if (filters.categories?.length) params.set("categories", filters.categories.join(","));
  if (filters.mechanics?.length) params.set("mechanics", filters.mechanics.join(","));
  if (filters.includeExpansions) params.set("includeExpansions", "true");
  return params.toString();
}

export const api = {
  listUsers: () => request<{ users: Player[] }>("/api/users"),
  login: (userId: number) =>
    request<CurrentUser>("/api/login", { method: "POST", body: JSON.stringify({ userId }) }),
  addProfile: (displayName: string) =>
    request<Player>("/api/users", { method: "POST", body: JSON.stringify({ displayName }) }),
  removeProfile: (id: number) => request<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),

  round: () => request<{ round: Round | null }>("/api/round"),
  startRound: (playerIds: number[]) =>
    request<{ round: Round }>("/api/round/start", { method: "POST", body: JSON.stringify({ playerIds }) }),
  resetRound: () => request<{ ok: true; swipes: number; matches: number }>("/api/round/reset", { method: "POST" }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  me: () => request<CurrentUser>("/api/me"),

  deck: (filters: Filters) => request<{ games: Game[] }>(`/api/games/deck?${filtersToQuery(filters)}`),
  categories: () => request<{ categories: string[] }>("/api/meta/categories"),
  mechanics: () => request<{ mechanics: string[] }>("/api/meta/mechanics"),

  swipe: (gameId: number, decision: "like" | "dislike") =>
    request<{ ok: true }>("/api/swipes", { method: "POST", body: JSON.stringify({ gameId, decision }) }),
  resetSwipes: () => request<{ ok: true }>("/api/swipes/reset", { method: "POST" }),

  matches: () => request<{ matches: Match[] }>("/api/matches"),
  markPlayed: (matchId: number) => request<{ ok: true }>(`/api/matches/${matchId}/played`, { method: "POST" }),

  importLinks: () => request<ImportLinks>("/api/import/links"),
  importXml: (xml: string) =>
    request<{ kind: string; message: string }>("/api/import", { method: "POST", body: JSON.stringify({ xml }) }),

  stats: (playerIds: number[]) =>
    request<Stats>(`/api/stats${playerIds.length ? `?players=${playerIds.join(",")}` : ""}`),

  setAvatar: (id: number, dataUrl: string) =>
    request<{ ok: true; avatar: string }>(`/api/users/${id}/avatar`, {
      method: "PUT",
      body: JSON.stringify({ dataUrl }),
    }),
  removeAvatar: (id: number) => request<{ ok: true }>(`/api/users/${id}/avatar`, { method: "DELETE" }),

  library: () => request<{ games: LibraryGame[] }>("/api/library"),
  setGameVisibility: (id: number, mode: ExpansionMode) =>
    request<{ ok: true; id: number; mode: ExpansionMode }>(`/api/library/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }),

  triggerSync: () => request<{ ok: true; started: boolean }>("/api/sync", { method: "POST" }),
  stopSync: () => request<{ ok: true; stopped: boolean }>("/api/sync/stop", { method: "POST" }),
  syncStatus: () =>
    request<{
      inProgress: boolean;
      last: { started_at: string; finished_at: string | null; status: string; games_added: number; games_updated: number; error: string | null } | null;
    }>("/api/sync/status"),
};
