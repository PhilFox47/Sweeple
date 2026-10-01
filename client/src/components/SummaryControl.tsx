import { useCallback, useEffect, useState } from "react";
import { api, type SummaryStatus } from "../api";

/** How many games still lack a summary, and the button that writes them. */
export default function SummaryControl({ refreshToken }: { refreshToken: number }) {
  const [status, setStatus] = useState<SummaryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.summaryStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status konnte nicht geladen werden");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // A run takes a while for a whole library; follow it without depending on the live socket.
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [status?.running, load]);

  async function generate() {
    setError(null);
    try {
      setStatus(await api.generateSummaries());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte nicht gestartet werden");
    }
  }

  if (!status) return null;

  return (
    <section className="panel">
      <h3>Kurzbeschreibungen</h3>
      <p className="panel-hint">
        Zwei, drei Sätze pro Spiel auf der Karte — was man darin macht und wie es sich anfühlt,
        für alle, die es noch nie gespielt haben. Sie werden aus der Beschreibung auf
        BoardGameGeek geschrieben; jede lässt sich oben in der Liste von Hand ändern.
      </p>

      {!status.configured ? (
        <p className="panel-note">
          Für automatische Kurzbeschreibungen fehlt <code>ANTHROPIC_API_KEY</code> in der{" "}
          <code>.env</code>. Von Hand schreiben geht trotzdem.
        </p>
      ) : status.running ? (
        <p className="panel-hint">Schreibe Kurzbeschreibungen… {status.done} fertig.</p>
      ) : status.missing === 0 ? (
        <p className="panel-hint">Alle Spiele haben eine Kurzbeschreibung.</p>
      ) : (
        <div className="row-actions">
          <button className="btn btn-ghost" onClick={generate} disabled={status.missingWithDescription === 0}>
            {status.missingWithDescription === 1
              ? "Fehlende Kurzbeschreibung schreiben"
              : `${status.missingWithDescription} fehlende Kurzbeschreibungen schreiben`}
          </button>
        </div>
      )}

      {status.configured && !status.running && status.missing > status.missingWithDescription && (
        <p className="panel-note">
          {status.missing - status.missingWithDescription}{" "}
          {status.missing - status.missingWithDescription === 1 ? "Spiel hat" : "Spiele haben"} noch keine
          Beschreibung von BGG — einmal mit BGG abgleichen, dann geht es weiter.
        </p>
      )}
      {(error || status.lastError) && <div className="form-error">{error ?? status.lastError}</div>}
    </section>
  );
}
