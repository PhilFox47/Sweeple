import { db } from "./db.js";
import { activeRoundId, matchParticipantIds } from "./rounds.js";
import { broadcast } from "./ws.js";

/**
 * When a game counts as a match.
 *
 * A full match — everyone in the round liked it — can happen at any time and always wins. With
 * three or more players that bar gets hard to clear: two quick players can pile up matches the
 * slower ones never agree with. So once the round has dragged on, the bar drops. Every player
 * beyond the second to get through most of their deck lowers the number of likes needed by one,
 * down to two. Those are soft matches: not everyone wanted it, but enough people did.
 */

/** How far through their own deck a player must be before they count as nearly done. */
export const SOFT_MATCH_PROGRESS = 0.75;

/** Never fewer than this: one person liking a game is a preference, not a match. */
const MINIMUM_LIKES = 2;

/**
 * Likes needed for a match, given how many are playing and how many are nearly done. The first
 * two to get there lower nothing — two fast players finishing is exactly the case this guards
 * against, not a reason to settle.
 */
export function requiredLikes(players: number, nearlyDone: number): number {
  if (players < 3) return players;
  const relief = Math.max(0, nearlyDone - 2);
  return Math.max(MINIMUM_LIKES, players - relief);
}

export interface PlayerProgress {
  id: number;
  swiped: number;
  /** Their deck under their own filters; null until they have fetched it this round. */
  deckTotal: number | null;
  /** 0–1. A player whose filters leave them nothing to swipe has nothing left to add: 1. */
  progress: number;
}

export interface Threshold {
  players: number;
  required: number;
  nearlyDone: number;
  progress: PlayerProgress[];
}

/** Called on every deck fetch. Returns whether the size changed, since that can move the bar. */
export function recordDeckTotal(userId: number, swiped: number, remaining: number): boolean {
  const roundId = activeRoundId();
  const total = swiped + remaining;
  const previous = db
    .prepare("SELECT deck_total FROM round_progress WHERE round_id = ? AND user_id = ?")
    .get(roundId, userId) as { deck_total: number } | undefined;
  if (previous?.deck_total === total) return false;

  db.prepare(
    `INSERT INTO round_progress (round_id, user_id, deck_total) VALUES (?, ?, ?)
     ON CONFLICT(round_id, user_id) DO UPDATE SET deck_total = excluded.deck_total, updated_at = datetime('now')`
  ).run(roundId, userId, total);
  return true;
}

export function currentThreshold(): Threshold {
  const participants = matchParticipantIds();
  const roundId = activeRoundId();

  const progress = participants.map((id): PlayerProgress => {
    // Swipes are cleared when a round starts, so these are tonight's.
    const swiped = (db.prepare("SELECT COUNT(*) AS n FROM swipes WHERE user_id = ?").get(id) as { n: number }).n;
    const row = db
      .prepare("SELECT deck_total FROM round_progress WHERE round_id = ? AND user_id = ?")
      .get(roundId, id) as { deck_total: number } | undefined;
    const deckTotal = row?.deck_total ?? null;
    const ratio = deckTotal === null ? 0 : deckTotal === 0 ? 1 : Math.min(swiped / deckTotal, 1);
    return { id, swiped, deckTotal, progress: ratio };
  });

  const nearlyDone = progress.filter((p) => p.progress >= SOFT_MATCH_PROGRESS).length;
  return {
    players: participants.length,
    required: requiredLikes(participants.length, nearlyDone),
    nearlyDone,
    progress,
  };
}

interface Candidate {
  game_id: number;
  likes: number;
  match_id: number | null;
  kind: string | null;
  match_likes: number | null;
  played_at: string | null;
}

/**
 * Brings tonight's matches in line with tonight's swipes. Run after anything that can change
 * either side of the comparison: a swipe, a player starting over, a deck changing size. Lowering
 * the bar can turn several games into matches at once, which is why this looks at every game
 * someone has liked rather than just the one swiped.
 */
export function reconcileMatches(): void {
  const participants = matchParticipantIds();
  if (participants.length === 0) return;

  const roundId = activeRoundId();
  const threshold = currentThreshold();
  const placeholders = participants.map(() => "?").join(",");

  // Every game with a like from a player in the round, plus every match still pending, so one
  // that no longer qualifies can be withdrawn.
  const rows = db
    .prepare(
      `WITH liked AS (
         SELECT game_id, COUNT(*) AS likes FROM swipes
         WHERE decision = 'like' AND user_id IN (${placeholders})
         GROUP BY game_id
       ),
       considered AS (
         SELECT game_id FROM liked
         UNION
         SELECT game_id FROM matches WHERE round_id = ? AND played_at IS NULL
       )
       SELECT c.game_id, COALESCE(l.likes, 0) AS likes,
              m.id AS match_id, m.kind, m.likes AS match_likes, m.played_at
       FROM considered c
       LEFT JOIN liked l ON l.game_id = c.game_id
       LEFT JOIN matches m ON m.game_id = c.game_id AND m.round_id = ?`
    )
    .all(...participants, roundId, roundId) as Candidate[];

  const announce: { gameId: number; kind: "full" | "soft"; likes: number }[] = [];

  db.transaction(() => {
    for (const row of rows) {
      // A game already played tonight is history; nothing re-decides it.
      if (row.played_at) continue;

      const full = row.likes >= threshold.players;
      const soft = !full && threshold.players >= 3 && row.likes >= threshold.required;
      const kind = full ? "full" : soft ? "soft" : null;

      if (kind && row.match_id === null) {
        db.prepare("INSERT INTO matches (game_id, round_id, kind, likes) VALUES (?, ?, ?, ?)").run(
          row.game_id,
          roundId,
          kind,
          row.likes
        );
        announce.push({ gameId: row.game_id, kind, likes: row.likes });
      } else if (kind && row.match_id !== null) {
        if (row.kind !== kind || row.match_likes !== row.likes) {
          db.prepare("UPDATE matches SET kind = ?, likes = ? WHERE id = ?").run(kind, row.likes, row.match_id);
        }
        // Everyone coming round to a soft match is news worth telling.
        if (row.kind === "soft" && kind === "full") announce.push({ gameId: row.game_id, kind, likes: row.likes });
      } else if (!kind && row.match_id !== null) {
        db.prepare("DELETE FROM matches WHERE id = ?").run(row.match_id);
      }
    }
  })();

  for (const item of announce) {
    const game = db.prepare("SELECT name, thumbnail FROM games WHERE id = ?").get(item.gameId) as
      | { name: string; thumbnail: string | null }
      | undefined;
    broadcast({
      type: "match",
      gameId: item.gameId,
      gameName: game?.name ?? "Unknown game",
      thumbnail: game?.thumbnail ?? null,
      kind: item.kind,
      likes: item.likes,
      players: threshold.players,
    });
  }
}
