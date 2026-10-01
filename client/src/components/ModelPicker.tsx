import { useEffect, useMemo, useState } from "react";
import { api, type ModelInfo } from "../api";

/** How many matches to render at once; Nano-GPT offers hundreds of models. */
const SHOWN = 40;

/**
 * Nano-GPT's model list with a search box. Whatever is typed can also be used as-is, which covers
 * a model the list does not show and a list that cannot be fetched at all.
 */
export default function ModelPicker({
  current,
  onPick,
  disabled,
}: {
  current: string | null;
  onPick: (model: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(!current);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || models) return;
    api
      .translationModels()
      .then((r) => setModels(r.models))
      .catch((err) => {
        setModels([]);
        setError(err instanceof Error ? err.message : "Modellliste nicht erreichbar.");
      });
  }, [open, models]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (models ?? []).filter((m) => !q || m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)),
    [models, q]
  );
  const typedIsListed = matches.some((m) => m.id === query.trim());

  function pick(id: string) {
    onPick(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="model-picker">
      <div className="model-current">
        <span className="model-label">Modell</span>
        <span className="model-id">{current ?? "keins ausgewählt"}</span>
        <button className="btn btn-quiet" onClick={() => setOpen((v) => !v)} disabled={disabled}>
          {open ? "Schließen" : "Ändern"}
        </button>
      </div>

      {open && (
        <div className="model-list-wrap">
          <input
            type="text"
            placeholder="Modell suchen oder ID eingeben"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {error && <p className="panel-note">{error} Du kannst die Modell-ID auch direkt eintippen.</p>}
          {models === null && <p className="panel-note">Lade Modelle…</p>}
          <div className="model-list">
            {query.trim() && !typedIsListed && (
              <button className="model-option" onClick={() => pick(query.trim())}>
                „{query.trim()}“ verwenden
              </button>
            )}
            {matches.slice(0, SHOWN).map((m) => (
              <button
                key={m.id}
                className={`model-option ${m.id === current ? "is-current" : ""}`}
                onClick={() => pick(m.id)}
              >
                <span className="model-option-id">{m.id}</span>
                {m.name && <span className="model-option-name">{m.name}</span>}
              </button>
            ))}
            {matches.length > SHOWN && (
              <p className="panel-note">… und {matches.length - SHOWN} weitere — Suche eingrenzen.</p>
            )}
            {models !== null && models.length > 0 && matches.length === 0 && !query.trim() && (
              <p className="panel-note">Keine Modelle gefunden.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
