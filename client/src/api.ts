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
  numPlays: number;
  lastPlayedAt: string | null;
  isExpansion: boolean;
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

export interface CurrentUser {
  id: number;
  username: string;
  displayName: string;
  role: "core" | "guest";
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
    headers: { "Content-Type": "application/json", ...options.headers },
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
  listUsers: () => request<{ users: { id: number; username: string; displayName: string }[] }>("/api/users"),
  login: (username: string, password: string) =>
    request<CurrentUser>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
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

  triggerSync: () => request<{ ok: true; started: boolean }>("/api/sync", { method: "POST" }),
  syncStatus: () =>
    request<{
      inProgress: boolean;
      last: { started_at: string; finished_at: string | null; status: string; games_added: number; games_updated: number; error: string | null } | null;
    }>("/api/sync/status"),
};
