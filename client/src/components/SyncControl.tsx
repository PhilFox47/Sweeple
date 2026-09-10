import { useEffect, useState } from "react";
import { api } from "../api";

export default function SyncControl({ syncSignal }: { syncSignal: number }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.syncStatus>> | null>(null);
  const [triggering, setTriggering] = useState(false);

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
    try {
      await api.triggerSync();
      await load();
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
      {last && !inProgress && (
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
