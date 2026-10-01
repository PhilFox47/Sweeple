import { useCallback, useEffect, useState } from "react";
import { api, type TranslationStatus } from "../api";

/** Where the card texts stand, and the button that translates the rest. */
export default function SummaryControl({ refreshToken }: { refreshToken: number }) {
  const [status, setStatus] = useState<TranslationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.translationStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status konnte nicht geladen werden");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // Follow a run without depending on the live socket.
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [status?.running, load]);

  async function translate() {
    setError(null);
    try {
      setStatus(await api.translateSummaries());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte nicht gestartet werden");
    }
  }

  if (!status) return null;
  const pending = status.withText - status.inGerman;

  return (
    <section className="panel">
      <h3>Kurzbeschreibungen</h3>
      <p className="panel-hint">
        Der kurze Text auf jeder Karte kommt von BoardGameGeek, auf Englisch. Mit Nano-GPT wird er
        übersetzt; jeden Text kannst du oben in der Liste auch von Hand auf Deutsch schreiben.
      </p>

      <p className="panel-hint">
        {status.inGerman} von {status.withText} auf Deutsch
        {status.withoutText > 0 && ` · ${status.withoutText} ohne Text von BGG`}
      </p>

      {!status.configured ? (
        <p className="panel-note">
          Ohne Übersetzung bleiben die Texte englisch. Dafür fehlt in der <code>.env</code>:{" "}
          {status.missing.map((name, i) => (
            <span key={name}>
              {i > 0 && " und "}
              <code>{name}</code>
            </span>
          ))}
          .
        </p>
      ) : status.running ? (
        <p className="panel-hint">Übersetze… {status.done} fertig.</p>
      ) : pending > 0 ? (
        <div className="row-actions">
          <button className="btn btn-ghost" onClick={translate}>
            {pending === 1 ? "Fehlenden Text übersetzen" : `${pending} fehlende Texte übersetzen`}
          </button>
        </div>
      ) : null}

      {status.configured && <p className="panel-note">Übersetzt mit {status.model} über Nano-GPT.</p>}
      {status.withoutText > 0 && (
        <p className="panel-note">Spiele ohne Text bekommen ihren beim nächsten Abgleich mit BGG.</p>
      )}
      {(error || status.lastError) && <div className="form-error">{error ?? status.lastError}</div>}
    </section>
  );
}
