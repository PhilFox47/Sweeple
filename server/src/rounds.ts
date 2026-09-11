import { db } from "./db.js";

export interface RoundPlayer {
  id: number;
  displayName: string;
  isAdmin: boolean;
}

export interface Round {
  id: number;
  startedAt: string;
  players: RoundPlayer[];
  playerCount: number;
}

interface RoundRow {
  id: number;
  started_at: string;
  player_ids: string;
}

function hydrate(row: RoundRow): Round {
  const ids = JSON.parse(row.player_ids) as number[];
  // Players can be removed between rounds, so read them back rather than trusting the snapshot.
  const players = ids
    .map(
      (id) =>
        db
          .prepare("SELECT id, display_name as displayName, role FROM users WHERE id = ?")
          .get(id) as { id: number; displayName: string; role: string } | undefined
    )
    .filter((p): p is { id: number; displayName: string; role: string } => Boolean(p))
    .map((p) => ({ id: p.id, displayName: p.displayName, isAdmin: p.role === "core" }));

  return { id: row.id, startedAt: row.started_at, players, playerCount: players.length };
}

/** The round a vote belongs to; 0 when swiping outside a round. */
export function activeRoundId(): number {
  const row = db.prepare("SELECT id FROM rounds WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;
  return row?.id ?? 0;
}

export function getActiveRound(): Round | null {
  const row = db
    .prepare("SELECT id, started_at, player_ids FROM rounds WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1")
    .get() as RoundRow | undefined;
  return row ? hydrate(row) : null;
}

/** Wipes the decisions of the current sitting. Played matches are history and are kept. */
export function clearRoundProgress(): { swipes: number; matches: number } {
  let swipes = 0;
  let matches = 0;
  db.transaction(() => {
    swipes = db.prepare("DELETE FROM swipes").run().changes;
    matches = db.prepare("DELETE FROM matches WHERE played_at IS NULL").run().changes;
  })();
  return { swipes, matches };
}

export function startRound(playerIds: number[]): Round {
  const unique = [...new Set(playerIds)];
  if (unique.length === 0) throw new Error("Pick at least one player for the round.");

  const known = db
    .prepare(`SELECT id FROM users WHERE id IN (${unique.map(() => "?").join(",")})`)
    .all(...unique) as { id: number }[];
  if (known.length !== unique.length) throw new Error("One of those players no longer exists.");

  db.transaction(() => {
    db.prepare("UPDATE rounds SET ended_at = datetime('now') WHERE ended_at IS NULL").run();
    db.prepare("INSERT INTO rounds (player_ids) VALUES (?)").run(JSON.stringify(unique));
  })();
  clearRoundProgress();

  return getActiveRound()!;
}

/**
 * Who must agree for a game to be a match. During a round that is everyone playing; with no
 * round started it falls back to the permanent profiles.
 */
export function matchParticipantIds(): number[] {
  const round = getActiveRound();
  if (round && round.players.length > 0) return round.players.map((p) => p.id);
  return (db.prepare("SELECT id FROM users WHERE role = 'core'").all() as { id: number }[]).map((u) => u.id);
}
