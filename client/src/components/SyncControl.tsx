import { useEffect, useState } from "react";
import { api, SYNC_STOPPED } from "../api";

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
      setError(err instanceof Error ? err.message : "Abgleich konnte nicht gestartet werden");
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
      setError(err instanceof Error ? err.message : "Abgleich konnte nicht gestoppt werden");
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
          Abgleich stoppen
        </button>
      ) : (
        <button className="btn btn-ghost" onClick={handleSync} disabled={busy}>
          {busy ? "Startet…" : "Mit BGG abgleichen"}
        </button>
      )}

      {inProgress && <span className="panel-hint">{progress ?? "Gleiche mit BGG ab…"}</span>}
      {error && <span className="form-error">{error}</span>}
      {!inProgress && !error && last && (
        <span className="panel-hint">
          {last.status === "success"
            ? `Zuletzt abgeglichen am ${new Date(last.finished_at ?? last.started_at).toLocaleString("de-DE")} — ${last.games_added} neu, ${last.games_updated} aktualisiert`
            : last.error === SYNC_STOPPED
              ? "Der letzte Abgleich wurde gestoppt"
              : `Der letzte Abgleich ist fehlgeschlagen: ${last.error}`}
        </span>
      )}
    </div>
  );
}
