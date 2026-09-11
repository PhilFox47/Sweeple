import { useEffect, useState } from "react";
import { api } from "../api";

export default function SyncControl({ syncSignal, progress }: { syncSignal: number; progress: string | null }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.syncStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setStatus(await api.syncStatus());
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
  }, [syncSignal]);

  async function handleSync() {
    setBusy(true);
    setError(null);
    try {
      await api.triggerSync();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sync");
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await api.stopSync();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop sync");
    } finally {
      setBusy(false);
    }
  }

  const last = status?.last;
  const inProgress = status?.inProgress ?? false;

  return (
    <div className="row-actions">
      {inProgress ? (
        <button className="btn btn-ghost" onClick={handleStop} disabled={busy}>
          Stop sync
        </button>
      ) : (
        <button className="btn btn-ghost" onClick={handleSync} disabled={busy}>
          {busy ? "Starting…" : "Sync with BGG"}
        </button>
      )}

      {inProgress && <span className="panel-hint">{progress ?? "Syncing with BGG…"}</span>}
      {error && <span className="form-error">{error}</span>}
      {!inProgress && !error && last && (
        <span className="panel-hint">
          {last.status === "success"
            ? `Last synced ${new Date(last.finished_at ?? last.started_at).toLocaleString()} — ${last.games_added} added, ${last.games_updated} updated`
            : last.error === "Sync stopped"
              ? "Last sync was stopped"
              : `Last sync failed: ${last.error}`}
        </span>
      )}
    </div>
  );
}
