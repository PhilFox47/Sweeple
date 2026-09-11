import { db } from "./db.js";

export interface PlayerRating {
  id: number;
  displayName: string;
  likes: number;
  total: number;
}

export interface GameRating {
  likes: number;
  total: number;
  /** 0–1, or null when nobody has voted on it yet. */
  ratio: number | null;
  byPlayer: PlayerRating[];
}

interface Row {
  game_id: number;
  user_id: number;
  display_name: string;
  likes: number;
  total: number;
}

/**
 * How often each game has been picked, per profile and overall. Built from the vote log, so it
 * spans every round rather than the current sitting, and a game nobody has seen yet simply has
 * no entry.
 */
export function gameRatings(): Map<number, GameRating> {
  const rows = db
    .prepare(
      `SELECT v.game_id, v.user_id, u.display_name,
              SUM(CASE WHEN v.decision = 'like' THEN 1 ELSE 0 END) AS likes,
              COUNT(*) AS total
       FROM votes v
       JOIN users u ON u.id = v.user_id
       GROUP BY v.game_id, v.user_id
       ORDER BY u.role = 'guest', u.id`
    )
    .all() as Row[];

  const ratings = new Map<number, GameRating>();
  for (const row of rows) {
    const rating = ratings.get(row.game_id) ?? { likes: 0, total: 0, ratio: null, byPlayer: [] };
    rating.likes += row.likes;
    rating.total += row.total;
    rating.ratio = rating.likes / rating.total;
    rating.byPlayer.push({ id: row.user_id, displayName: row.display_name, likes: row.likes, total: row.total });
    ratings.set(row.game_id, rating);
  }
  return ratings;
}

export const EMPTY_RATING: GameRating = { likes: 0, total: 0, ratio: null, byPlayer: [] };

/** One player's own history, for the game they are looking at right now. */
export function ratingsForUser(userId: number): Map<number, { likes: number; total: number }> {
  const rows = db
    .prepare(
      `SELECT game_id,
              SUM(CASE WHEN decision = 'like' THEN 1 ELSE 0 END) AS likes,
              COUNT(*) AS total
       FROM votes WHERE user_id = ? GROUP BY game_id`
    )
    .all(userId) as { game_id: number; likes: number; total: number }[];
  return new Map(rows.map((r) => [r.game_id, { likes: r.likes, total: r.total }]));
}
