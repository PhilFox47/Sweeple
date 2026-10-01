import { db } from "./db.js";
import { fetchCollection, fetchGameDetails, fetchPlayStats, fetchShortDescriptions, isCancellation } from "./bgg.js";
import { applyCollection, applyDetails, applyPlays, applyShortDescriptions, gamesNeedingShortDescription } from "./store.js";
import { broadcast } from "./ws.js";
import { translateMissing } from "./translate.js";

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
    throw new Error("BGG_USERNAME ist nicht eingerichtet.");
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
    options.onProgress("Frage die Sammlung bei BGG an");
    const collection = await fetchCollection(username, options);
    if (collection.length === 0) {
      // Rather than trust an empty response and mark the whole library as no longer owned.
      throw new Error(
        `BGG hat für „${username}“ eine leere Sammlung geliefert. Die vorhandenen Spiele bleiben unverändert.`
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
    const result = applyCollection(collection);
    applyDetails(details);
    applyPlays(playStats);

    // After the collection is applied, so newly added games are in the table to be asked about.
    // A missing blurb is no reason to fail a sync; a game that could not be asked is retried next time.
    const blurbs = await fetchShortDescriptions(gamesNeedingShortDescription(), options);
    applyShortDescriptions(blurbs);

    gamesAdded = result.added;
    gamesUpdated = result.updated;

    db.prepare(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'success', games_added = ?, games_updated = ? WHERE id = ?"
    ).run(gamesAdded, gamesUpdated, logId);

    broadcast({ type: "sync-finished", status: "success", gamesAdded, gamesUpdated });
    // New or changed English gets its German version. Not awaited: the sync is done, this is extra.
    void translateMissing();
  } catch (err) {
    const cancelled = isCancellation(err);
    const message = cancelled ? "Abgleich gestoppt" : err instanceof Error ? err.message : String(err);
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
