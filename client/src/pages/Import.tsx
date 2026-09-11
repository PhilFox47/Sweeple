import { useEffect, useState } from "react";
import { api, type ImportLinks } from "../api";

function LinkRow({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="link-row">
      <a href={url} target="_blank" rel="noreferrer" className="link-row-url">
        {label}
      </a>
      <button
        className="secondary-button"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy link"}
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
      setError(err instanceof Error ? err.message : "Could not load import links");
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
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const remaining = links?.detailBatches.length ?? 0;

  return (
    <div className="import-page">
      <p className="import-intro">
        BGG blocks automated requests, so fetch each link in your browser and paste the response
        below. Sweeple works out which kind of response it is.
      </p>

      <section className="import-step">
        <h3>1. Your collection</h3>
        <p className="import-hint">
          Open this, and if it says the request is being processed, reload after a few seconds until
          you see the game list.
        </p>
        {links && <LinkRow url={links.collectionUrl} label={`Collection for ${links.username || "?"}`} />}
        {links && (
          <p className="import-status">
            {links.gamesTotal > 0
              ? `${links.gamesTotal} games in your library.`
              : "No games imported yet."}
          </p>
        )}
      </section>

      <section className="import-step">
        <h3>2. Game details</h3>
        <p className="import-hint">
          Player counts, playtime, weight, categories and mechanics — and which entries are
          expansions. BGG caps this at 20 games per request, so there may be several links.
        </p>
        {links && links.gamesTotal > 0 && (
          <p className="import-status">
            {links.gamesWithDetails} of {links.gamesTotal} games have details
            {remaining > 0 ? ` — ${remaining} link${remaining === 1 ? "" : "s"} left to paste.` : " — all done."}
          </p>
        )}
        {links?.detailBatches.map((batch, i) => (
          <LinkRow key={batch.url} url={batch.url} label={`Details batch ${i + 1} (${batch.count} games)`} />
        ))}
      </section>

      <section className="import-step">
        <h3>3. Play history (optional)</h3>
        <p className="import-hint">
          Adds the dates behind the "not played recently" filter. Play counts already come from your
          collection. If you have many plays, paste each page (add <code>&amp;page=2</code> and so on).
        </p>
        {links && <LinkRow url={links.playsUrl} label="Play history" />}
      </section>

      <section className="import-step">
        <h3>Paste the response</h3>
        <textarea
          className="import-textarea"
          value={xml}
          onChange={(e) => setXml(e.target.value)}
          placeholder="Paste the XML from any of the links above…"
          spellCheck={false}
        />
        <div className="import-actions">
          <button className="primary-button" onClick={handleImport} disabled={busy || !xml.trim()}>
            {busy ? "Importing…" : "Import"}
          </button>
          <button className="secondary-button" onClick={() => setXml("")} disabled={!xml}>
            Clear
          </button>
        </div>
        {result && <div className="import-result">{result}</div>}
        {error && <div className="form-error">{error}</div>}
      </section>
    </div>
  );
}
