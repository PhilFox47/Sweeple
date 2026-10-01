import { useEffect, useState } from "react";
import { api, type ImportLinks } from "../api";

function LinkRow({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="link-row">
      <a href={url} target="_blank" rel="noreferrer" >
        {label}
      </a>
      <button
        className="btn btn-ghost"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Kopiert" : "Link kopieren"}
      </button>
    </div>
  );
}

export default function Import({ refreshToken, onImported }: { refreshToken: number; onImported: () => void }) {
  const [links, setLinks] = useState<ImportLinks | null>(null);
  const [xml, setXml] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLinks(await api.importLinks());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Die Import-Links konnten nicht geladen werden");
    }
  }

  useEffect(() => {
    load();
  }, [refreshToken]);

  async function handleImport() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.importXml(xml);
      setResult(res.message);
      setXml("");
      await load();
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const remaining = links?.detailBatches.length ?? 0;

  return (
    <div className="import-page">
      {links?.hasToken ? (
        <p className="form-ok">
          Ein BGG-API-Token ist eingerichtet, <strong>Mit BGG abgleichen</strong> holt also alles
          automatisch. Der Import von Hand unten bleibt als Ausweichweg erhalten.
        </p>
      ) : (
        <p className="panel-hint">
          Ohne BGG-API-Token kann der Server die API nicht abfragen. Öffne dann jeden Link im Browser
          und füge die Antwort unten ein — Sweeple erkennt selbst, um welche es sich handelt.
        </p>
      )}

      <section className="panel">
        <h3>1. Deine Sammlung</h3>
        <p className="panel-hint">
          Öffnen, und falls dort steht, dass die Anfrage bearbeitet wird: nach ein paar Sekunden neu
          laden, bis die Spieleliste erscheint.
        </p>
        {links && <LinkRow url={links.collectionUrl} label={`Sammlung von ${links.username || "?"}`} />}
        {links && (
          <p className="panel-hint">
            {links.gamesTotal > 0
              ? `${links.gamesTotal} Spiele in der Bibliothek.`
              : "Noch keine Spiele importiert."}
          </p>
        )}
      </section>

      <section className="panel">
        <h3>2. Spieldetails</h3>
        <p className="panel-hint">
          Spielerzahl, Spieldauer, Komplexität, Kategorien, Mechaniken und die Beschreibung — und
          welche Einträge Erweiterungen sind. BGG liefert höchstens 20 Spiele pro Anfrage, daher
          eventuell mehrere Links.{" "}<strong>Dieser Endpunkt braucht ein API-Token</strong>, das ein
          Browser nicht mitschicken kann — ohne liefern die Links „Unauthorized“. Besser BGG_TOKEN
          setzen und mit BGG abgleichen.
        </p>
        {links && links.gamesTotal > 0 && (
          <p className="panel-hint">
            {links.gamesWithDetails} von {links.gamesTotal} Spielen haben Details
            {remaining > 0 ? ` — noch ${remaining} ${remaining === 1 ? "Link" : "Links"} einzufügen.` : " — alles erledigt."}
          </p>
        )}
        {links?.detailBatches.map((batch, i) => (
          <LinkRow key={batch.url} url={batch.url} label={`Details, Teil ${i + 1} (${batch.count} Spiele)`} />
        ))}
      </section>

      <section className="panel">
        <h3>3. Partien (optional)</h3>
        <p className="panel-hint">
          Liefert die Daten für den Filter „seit … Tagen nicht gespielt“. Die Anzahl der Partien
          kommt schon aus der Sammlung. Ebenfalls nur mit Token. Bei vielen Partien jede Seite
          einzeln einfügen (<code>&amp;page=2</code> anhängen und so weiter).
        </p>
        {links && <LinkRow url={links.playsUrl} label="Partien" />}
      </section>

      <section className="panel">
        <h3>Antwort einfügen</h3>
        <textarea
          className="import-textarea"
          value={xml}
          onChange={(e) => setXml(e.target.value)}
          placeholder="XML aus einem der Links oben hier einfügen…"
          spellCheck={false}
        />
        <div className="row-actions">
          <button className="btn btn-primary" onClick={handleImport} disabled={busy || !xml.trim()}>
            {busy ? "Importiere…" : "Importieren"}
          </button>
          <button className="btn btn-ghost" onClick={() => setXml("")} disabled={!xml}>
            Leeren
          </button>
        </div>
        {result && <div className="form-ok">{result}</div>}
        {error && <div className="form-error">{error}</div>}
      </section>
    </div>
  );
}
