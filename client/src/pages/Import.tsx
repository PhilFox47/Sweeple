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
      {links?.hasToken ? (
        <p className="form-ok">
          A BGG API token is configured, so <strong>Sync with BGG</strong> can fetch everything
          automatically. Manual import below stays available as a fallback.
        </p>
      ) : (
        <p className="panel-hint">
          Without a BGG API token the server cannot call the API, so fetch each link in your browser
          and paste the response below. Sweeple works out which kind of response it is.
        </p>
      )}

      <section className="panel">
        <h3>1. Your collection</h3>
        <p className="panel-hint">
          Open this, and if it says the request is being processed, reload after a few seconds until
          you see the game list.
        </p>
        {links && <LinkRow url={links.collectionUrl} label={`Collection for ${links.username || "?"}`} />}
        {links && (
          <p className="panel-hint">
            {links.gamesTotal > 0
              ? `${links.gamesTotal} games in your library.`
              : "No games imported yet."}
          </p>
        )}
      </section>

      <section className="panel">
        <h3>2. Game details</h3>
        <p className="panel-hint">
          Player counts, playtime, weight, categories and mechanics — and which entries are
          expansions. BGG caps this at 20 games per request, so there may be several links.
          {" "}<strong>This endpoint requires an API token</strong>, which a browser cannot send —
          opening these links without one returns "Unauthorized". Set BGG_TOKEN and use Sync
          with BGG instead.
        </p>
        {links && links.gamesTotal > 0 && (
          <p className="panel-hint">
            {links.gamesWithDetails} of {links.gamesTotal} games have details
            {remaining > 0 ? ` — ${remaining} link${remaining === 1 ? "" : "s"} left to paste.` : " — all done."}
          </p>
        )}
        {links?.detailBatches.map((batch, i) => (
          <LinkRow key={batch.url} url={batch.url} label={`Details batch ${i + 1} (${batch.count} games)`} />
        ))}
      </section>

      <section className="panel">
        <h3>3. Play history (optional)</h3>
        <p className="panel-hint">
          Adds the dates behind the "not played recently" filter. Play counts already come from your
          collection. Also token-only. If you have many plays, paste each page (add{" "}
          <code>&amp;page=2</code> and so on).
        </p>
        {links && <LinkRow url={links.playsUrl} label="Play history" />}
      </section>

      <section className="panel">
        <h3>Paste the response</h3>
        <textarea
          className="import-textarea"
          value={xml}
          onChange={(e) => setXml(e.target.value)}
          placeholder="Paste the XML from any of the links above…"
          spellCheck={false}
        />
        <div className="row-actions">
          <button className="btn btn-primary" onClick={handleImport} disabled={busy || !xml.trim()}>
            {busy ? "Importing…" : "Import"}
          </button>
          <button className="btn btn-ghost" onClick={() => setXml("")} disabled={!xml}>
            Clear
          </button>
        </div>
        {result && <div className="form-ok">{result}</div>}
        {error && <div className="form-error">{error}</div>}
      </section>
    </div>
  );
}
