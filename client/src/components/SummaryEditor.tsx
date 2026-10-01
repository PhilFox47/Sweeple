import { useState } from "react";
import { api, type LibraryGame } from "../api";

/**
 * The summary for one game, editable. Saving makes it hand-written, which the generator never
 * touches again; clearing it hands the game back to the generator.
 */
export default function SummaryEditor({ game, onSaved }: { game: LibraryGame; onSaved: (summary: string | null) => void }) {
  const [text, setText] = useState(game.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api.setSummary(game.id, next);
      onSaved(next?.trim() || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Das konnte nicht gespeichert werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="summary-editor">
      <textarea
        rows={4}
        maxLength={600}
        placeholder="Zwei, drei Sätze: was man in dem Spiel macht und wie es sich anfühlt."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="summary-editor-foot">
        <span className="summary-source">
          {game.summarySource === "manual"
            ? "Von Hand geschrieben"
            : game.summarySource === "ai"
              ? "Automatisch erzeugt"
              : "Noch keine Kurzbeschreibung"}
        </span>
        {game.summary && (
          <button className="btn btn-quiet" disabled={busy} onClick={() => save(null).then(() => setText(""))}>
            Leeren
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={busy || !text.trim() || text.trim() === game.summary}
          onClick={() => save(text)}
        >
          Speichern
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
