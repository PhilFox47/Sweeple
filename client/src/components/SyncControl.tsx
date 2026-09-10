import { useEffect, useState } from "react";
import { api } from "../api";

export default function SyncControl({ syncSignal }: { syncSignal: number }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.syncStatus>> | null>(null);
  const [triggering, setTriggering] = useState(false);
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
    setTriggering(true);
    setError(null);
    try {
      await api.triggerSync();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sync");
    } finally {
      setTriggering(false);
    }
  }

  const last = status?.last;
  const inProgress = status?.inProgress || triggering;

  return (
    <div className="sync-control">
      <button className="secondary-button" onClick={handleSync} disabled={inProgress}>
        {inProgress ? "Syncing…" : "Sync with BGG"}
      </button>
      {error && <span className="form-error">{error}</span>}
      {last && !inProgress && !error && (
        <span className="sync-status-text">
          {last.status === "success"
            ? `Last synced ${new Date(last.finished_at ?? last.started_at).toLocaleString()}`
            : last.status === "error"
              ? `Last sync failed: ${last.error}`
              : "Syncing…"}
        </span>
      )}
    </div>
  );
}
