import { useState } from "react";
import { api, type LibraryGame } from "../api";

/**
 * The German text for one game, next to BGG's English original. Saving makes it hand-written,
 * which nothing replaces; clearing goes back to BGG's text or its translation.
 */
export default function SummaryEditor({ game, onSaved }: { game: LibraryGame; onSaved: () => void }) {
  const [text, setText] = useState(game.summaryLanguage === "de" ? (game.summary ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api.setSummary(game.id, next);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Das konnte nicht gespeichert werden");
    } finally {
      setBusy(false);
    }
  }

  const source =
    game.summarySource === "manual"
      ? "Von Hand geschrieben"
      : game.summaryLanguage === "de"
        ? `Übersetzt${game.summaryModel ? ` mit ${game.summaryModel}` : ""}`
        : game.english
          ? "Noch englisch"
          : "BGG hat keinen Text für dieses Spiel";

  return (
    <div className="summary-editor">
      {game.english && (
        <p className="summary-original">
          <span className="summary-original-label">BGG</span> {game.english}
        </p>
      )}
      <textarea
        rows={3}
        maxLength={600}
        placeholder="Auf Deutsch, in ein, zwei Sätzen."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="summary-editor-foot">
        <span className="summary-source">{source}</span>
        {game.summarySource === "manual" && (
          <button className="btn btn-quiet" disabled={busy} onClick={() => save(null).then(() => setText(""))}>
            Zurücksetzen
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={busy || !text.trim() || (game.summaryLanguage === "de" && text.trim() === game.summary)}
          onClick={() => save(text)}
        >
          Speichern
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
