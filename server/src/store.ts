import { db } from "./db.js";
import type { CollectionItem, GameDetails, PlayStats } from "./bgg.js";

export interface CollectionResult {
  added: number;
  updated: number;
  markedUnowned: number;
}

const upsertCollectionItem = db.prepare(`
  INSERT INTO games (
    bgg_id, name, year_published, thumbnail, image, num_plays, is_expansion, owned,
    last_synced_at, updated_at
  ) VALUES (
    @bggId, @name, @yearPublished, @thumbnail, @image, @numPlays, @isExpansion, 1,
    datetime('now'), datetime('now')
  )
  ON CONFLICT(bgg_id) DO UPDATE SET
    name = excluded.name,
    year_published = excluded.year_published,
    thumbnail = excluded.thumbnail,
    image = excluded.image,
    num_plays = excluded.num_plays,
    owned = 1,
    last_synced_at = datetime('now'),
    updated_at = datetime('now')
`);

/**
 * Applies an owned-collection snapshot. Anything absent from it is marked not owned rather than
 * deleted, so swipes and match history for a game that leaves the shelf survive.
 */
export function applyCollection(items: CollectionItem[]): CollectionResult {
  const existing = new Set(
    (db.prepare("SELECT bgg_id FROM games").all() as { bgg_id: number }[]).map((r) => r.bgg_id)
  );
  const incoming = new Set(items.map((i) => i.bggId));
  let added = 0;
  let updated = 0;
  let markedUnowned = 0;

  db.transaction(() => {
    for (const item of items) {
      upsertCollectionItem.run({
        bggId: item.bggId,
        name: item.name,
        yearPublished: item.yearPublished,
        thumbnail: item.thumbnail,
        image: item.image,
        numPlays: item.numPlays,
        isExpansion: item.isExpansion ? 1 : 0,
      });
      if (existing.has(item.bggId)) updated += 1;
      else added += 1;
    }

    const gone = [...existing].filter((id) => !incoming.has(id));
    const markUnowned = db.prepare(
      "UPDATE games SET owned = 0, updated_at = datetime('now') WHERE bgg_id = ? AND owned = 1"
    );
    for (const id of gone) markedUnowned += markUnowned.run(id).changes;
  })();

  return { added, updated, markedUnowned };
}

const updateDetails = db.prepare(`
  UPDATE games SET
    min_players = @minPlayers,
    max_players = @maxPlayers,
    min_playtime = @minPlaytime,
    max_playtime = @maxPlaytime,
    playing_time = @playingTime,
    weight = @weight,
    average_rating = @averageRating,
    bgg_rank = @bggRank,
    categories = @categories,
    mechanics = @mechanics,
    is_expansion = @isExpansion,
    last_synced_at = datetime('now'),
    updated_at = datetime('now')
  WHERE bgg_id = @bggId
`);

export function applyDetails(details: GameDetails[]): { updated: number; unknown: number } {
  let updated = 0;
  let unknown = 0;
  db.transaction(() => {
    for (const d of details) {
      const changes = updateDetails.run({
        bggId: d.bggId,
        minPlayers: d.minPlayers,
        maxPlayers: d.maxPlayers,
        minPlaytime: d.minPlaytime,
        maxPlaytime: d.maxPlaytime,
        playingTime: d.playingTime,
        weight: d.weight,
        averageRating: d.averageRating,
        bggRank: d.bggRank,
        categories: JSON.stringify(d.categories),
        mechanics: JSON.stringify(d.mechanics),
        isExpansion: d.isExpansion ? 1 : 0,
      }).changes;
      if (changes > 0) updated += 1;
      else unknown += 1;
    }
  })();
  return { updated, unknown };
}

/**
 * Play pages can be imported one at a time, so counts and dates only ever move forward —
 * pasting page 2 after page 1 must not discard page 1.
 */
export function applyPlays(stats: Map<number, PlayStats>): { updated: number } {
  const update = db.prepare(`
    UPDATE games SET
      num_plays = MAX(num_plays, @numPlays),
      last_played_at = CASE
        WHEN last_played_at IS NULL OR @lastPlayedAt > last_played_at THEN @lastPlayedAt
        ELSE last_played_at
      END,
      updated_at = datetime('now')
    WHERE bgg_id = @bggId
  `);
  let updated = 0;
  db.transaction(() => {
    for (const s of stats.values()) {
      updated += update.run({ bggId: s.bggId, numPlays: s.numPlays, lastPlayedAt: s.lastPlayedAt }).changes;
    }
  })();
  return { updated };
}

/** Games that still need details from the thing endpoint, in stable order. */
export function gamesMissingDetails(): number[] {
  return (
    db
      .prepare("SELECT bgg_id FROM games WHERE owned = 1 AND weight IS NULL ORDER BY bgg_id")
      .all() as { bgg_id: number }[]
  ).map((r) => r.bgg_id);
}

export function allOwnedIds(): number[] {
  return (
    db.prepare("SELECT bgg_id FROM games WHERE owned = 1 ORDER BY bgg_id").all() as { bgg_id: number }[]
  ).map((r) => r.bgg_id);
}
