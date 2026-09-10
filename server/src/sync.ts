import { db } from "./db.js";
import { fetchCollection, fetchGameDetails, fetchPlayStats, isCancellation } from "./bgg.js";
import { broadcast } from "./ws.js";

let syncInProgress = false;
let controller: AbortController | null = null;

export function isSyncInProgress() {
  return syncInProgress;
}

export function stopSync(): boolean {
  if (!syncInProgress || !controller) return false;
  controller.abort();
  return true;
}

export async function runSync(): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
  controller = new AbortController();
  broadcast({ type: "sync-started" });

  const username = process.env.BGG_USERNAME;
  if (!username) {
    syncInProgress = false;
    controller = null;
    throw new Error("BGG_USERNAME is not configured");
  }

  const options = {
    signal: controller.signal,
    onProgress: (message: string) => broadcast({ type: "sync-progress", message }),
  };

  const logStmt = db.prepare(
    "INSERT INTO sync_log (started_at, status) VALUES (datetime('now'), 'running')"
  );
  const logId = logStmt.run().lastInsertRowid;

  let gamesAdded = 0;
  let gamesUpdated = 0;

  try {
    options.onProgress("Requesting your collection from BGG");
    const collection = await fetchCollection(username, options);
    if (collection.length === 0) {
      // Rather than trust an empty response and mark the whole library as no longer owned.
      throw new Error(
        `BGG returned an empty collection for "${username}". Leaving the existing games untouched.`
      );
    }
    const details = await fetchGameDetails(
      collection.map((c) => c.bggId),
      options
    );
    // Play history can be private even when the collection is public. It only powers the
    // "not played recently" filter, so a failure here must not sink the whole sync.
    const playStats = await fetchPlayStats(username, options).catch((err) => {
      if (isCancellation(err)) throw err;
      console.warn(`[sync] Could not fetch BGG play stats: ${err instanceof Error ? err.message : err}`);
      return new Map<number, { bggId: number; numPlays: number; lastPlayedAt: string | null }>();
    });
    const detailsById = new Map(details.map((d) => [d.bggId, d]));
    const collectionIds = new Set(collection.map((c) => c.bggId));

    const upsert = db.prepare(`
      INSERT INTO games (
        bgg_id, name, year_published, thumbnail, image, min_players, max_players,
        min_playtime, max_playtime, playing_time, weight, average_rating, bgg_rank,
        categories, mechanics, num_plays, last_played_at, is_expansion, owned,
        last_synced_at, updated_at
      ) VALUES (
        @bggId, @name, @yearPublished, @thumbnail, @image, @minPlayers, @maxPlayers,
        @minPlaytime, @maxPlaytime, @playingTime, @weight, @averageRating, @bggRank,
        @categories, @mechanics, @numPlays, @lastPlayedAt, @isExpansion, 1,
        datetime('now'), datetime('now')
      )
      ON CONFLICT(bgg_id) DO UPDATE SET
        name = excluded.name,
        year_published = excluded.year_published,
        thumbnail = excluded.thumbnail,
        image = excluded.image,
        min_players = excluded.min_players,
        max_players = excluded.max_players,
        min_playtime = excluded.min_playtime,
        max_playtime = excluded.max_playtime,
        playing_time = excluded.playing_time,
        weight = excluded.weight,
        average_rating = excluded.average_rating,
        bgg_rank = excluded.bgg_rank,
        categories = excluded.categories,
        mechanics = excluded.mechanics,
        num_plays = excluded.num_plays,
        last_played_at = excluded.last_played_at,
        is_expansion = excluded.is_expansion,
        owned = 1,
        last_synced_at = datetime('now'),
        updated_at = datetime('now')
    `);

    const existingIds = new Set(
      (db.prepare("SELECT bgg_id FROM games").all() as { bgg_id: number }[]).map((r) => r.bgg_id)
    );

    const tx = db.transaction(() => {
      for (const item of collection) {
        const detail = detailsById.get(item.bggId);
        const plays = playStats.get(item.bggId);
        upsert.run({
          bggId: item.bggId,
          name: detail?.name ?? item.name,
          yearPublished: detail?.yearPublished ?? item.yearPublished,
          thumbnail: detail?.thumbnail ?? item.thumbnail,
          image: detail?.image ?? item.image,
          minPlayers: detail?.minPlayers ?? null,
          maxPlayers: detail?.maxPlayers ?? null,
          minPlaytime: detail?.minPlaytime ?? null,
          maxPlaytime: detail?.maxPlaytime ?? null,
          playingTime: detail?.playingTime ?? null,
          weight: detail?.weight ?? null,
          averageRating: detail?.averageRating ?? null,
          bggRank: detail?.bggRank ?? null,
          categories: JSON.stringify(detail?.categories ?? []),
          mechanics: JSON.stringify(detail?.mechanics ?? []),
          numPlays: plays?.numPlays ?? 0,
          lastPlayedAt: plays?.lastPlayedAt ?? null,
          isExpansion: item.isExpansion ? 1 : 0,
        });
        if (existingIds.has(item.bggId)) gamesUpdated += 1;
        else gamesAdded += 1;
      }

      // Mark games no longer in the BGG collection as not owned, but keep history.
      const noLongerOwned = [...existingIds].filter((id) => !collectionIds.has(id));
      if (noLongerOwned.length > 0) {
        const markUnowned = db.prepare("UPDATE games SET owned = 0, updated_at = datetime('now') WHERE bgg_id = ?");
        for (const id of noLongerOwned) markUnowned.run(id);
      }
    });
    tx();

    db.prepare(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'success', games_added = ?, games_updated = ? WHERE id = ?"
    ).run(gamesAdded, gamesUpdated, logId);

    broadcast({ type: "sync-finished", status: "success", gamesAdded, gamesUpdated });
  } catch (err) {
    const cancelled = isCancellation(err);
    const message = cancelled ? "Sync stopped" : err instanceof Error ? err.message : String(err);
    db.prepare(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'error', error = ? WHERE id = ?"
    ).run(message, logId);
    broadcast({ type: "sync-finished", status: "error", gamesAdded, gamesUpdated, error: message });
    if (!cancelled) throw err;
  } finally {
    syncInProgress = false;
    controller = null;
    // Chromium is only needed while syncing; don't leave it resident between weekly runs.
    await import("./browser.js").then((m) => m.closeBrowser()).catch(() => {});
  }
}
