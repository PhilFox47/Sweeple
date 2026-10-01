import { useCallback, useEffect, useState } from "react";
import { api, type Sample, type TranslationStatus } from "../api";
import ModelPicker from "./ModelPicker";

/** Where the card texts stand: the model, a sample to judge it by, and translating. */
export default function SummaryControl({ refreshToken }: { refreshToken: number }) {
  const [status, setStatus] = useState<TranslationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ model: string; samples: Sample[] } | null>(null);
  const [sampling, setSampling] = useState(false);

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
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [status?.running, load]);

  async function act(action: () => Promise<TranslationStatus>) {
    setError(null);
    try {
      setStatus(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Das hat nicht geklappt");
    }
  }

  async function sample() {
    if (!status?.model) return;
    setSampling(true);
    setError(null);
    try {
      setSamples(await api.sampleTranslations(status.model));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Probe fehlgeschlagen");
    } finally {
      setSampling(false);
    }
  }

  function retranslateAll() {
    if (!status?.model) return;
    const count = status.withText;
    if (
      !confirm(
        `Alle Texte mit „${status.model}“ neu übersetzen? Übersetzt wird wieder vom englischen Original von BGG. ` +
          `Von Hand geschriebene Texte bleiben, wie sie sind. Bis zu ${count} Anfragen an Nano-GPT.`
      )
    )
      return;
    setSamples(null);
    act(() => api.translateSummaries(true));
  }

  if (!status) return null;
  const pending = status.withText - status.inGerman;
  const hasKey = !status.missing.includes("NANOGPT_API_KEY");

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

      {!hasKey ? (
        <p className="panel-note">
          Ohne Übersetzung bleiben die Texte englisch. Dafür fehlt <code>NANOGPT_API_KEY</code> in der{" "}
          <code>.env</code>.
        </p>
      ) : (
        <>
          <ModelPicker
            current={status.model}
            disabled={status.running}
            onPick={(model) => {
              setSamples(null);
              act(() => api.setTranslationModel(model));
            }}
          />

          {status.running ? (
            <p className="panel-hint">
              {status.retranslating ? "Übersetze alles neu" : "Übersetze"} mit {status.model}… {status.done} von{" "}
              {status.runTotal}
            </p>
          ) : (
            status.model && (
              <div className="row-actions">
                <button className="btn btn-ghost" onClick={sample} disabled={sampling}>
                  {sampling ? "Probiere…" : "Probe übersetzen"}
                </button>
                {pending > 0 && (
                  <button className="btn btn-ghost" onClick={() => act(() => api.translateSummaries(false))}>
                    {pending === 1 ? "Fehlenden übersetzen" : `${pending} fehlende übersetzen`}
                  </button>
                )}
                {status.inGerman > 0 && (
                  <button className="btn btn-ghost" onClick={retranslateAll}>
                    Alle neu übersetzen
                  </button>
                )}
              </div>
            )
          )}

          {samples && (
            <div className="samples">
              <p className="panel-note">
                Probe mit {samples.model} — nichts davon wird gespeichert. Es sind jedes Mal dieselben
                Texte, damit sich Modelle vergleichen lassen.
              </p>
              {samples.samples.map((s) => (
                <div className="sample" key={s.name}>
                  <div className="sample-name">{s.name}</div>
                  <p className="sample-line sample-en">
                    <span className="sample-label">BGG</span>
                    {s.english}
                  </p>
                  {s.current && (
                    <p className="sample-line">
                      <span className="sample-label">Bisher</span>
                      {s.current}
                    </p>
                  )}
                  <p className="sample-line sample-new">
                    <span className="sample-label">Neu</span>
                    {s.candidate ?? "— keine Antwort —"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {status.withoutText > 0 && (
        <p className="panel-note">Spiele ohne Text bekommen ihren beim nächsten Abgleich mit BGG.</p>
      )}
      {(error || status.lastError) && <div className="form-error">{error ?? status.lastError}</div>}
    </section>
  );
}
