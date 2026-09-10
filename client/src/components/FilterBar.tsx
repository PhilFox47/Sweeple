import { useEffect, useState } from "react";
import { api, type Filters } from "../api";

export default function FilterBar({
  filters,
  onChange,
  onClose,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<string[]>([]);
  const [mechanics, setMechanics] = useState<string[]>([]);
  const [draft, setDraft] = useState<Filters>(filters);

  useEffect(() => {
    api.categories().then((r) => setCategories(r.categories));
    api.mechanics().then((r) => setMechanics(r.mechanics));
  }, []);

  function toggleFromList(list: string[] | undefined, value: string): string[] {
    const current = list ?? [];
    return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  }

  return (
    <div className="filter-panel">
      <div className="filter-panel-header">
        <h3>Filters</h3>
        <button onClick={onClose} className="icon-button">✕</button>
      </div>

      <label className="filter-field">
        Player count
        <input
          type="number"
          min={1}
          placeholder="e.g. 2"
          value={draft.playerCount ?? ""}
          onChange={(e) => setDraft({ ...draft, playerCount: e.target.value ? Number(e.target.value) : undefined })}
        />
      </label>

      <label className="filter-field">
        Weight range
        <div className="filter-range">
          <input
            type="number"
            step={0.1}
            min={1}
            max={5}
            placeholder="min"
            value={draft.weightMin ?? ""}
            onChange={(e) => setDraft({ ...draft, weightMin: e.target.value ? Number(e.target.value) : undefined })}
          />
          <input
            type="number"
            step={0.1}
            min={1}
            max={5}
            placeholder="max"
            value={draft.weightMax ?? ""}
            onChange={(e) => setDraft({ ...draft, weightMax: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </label>

      <label className="filter-field">
        Max playtime (minutes)
        <input
          type="number"
          min={1}
          placeholder="e.g. 60"
          value={draft.maxPlaytime ?? ""}
          onChange={(e) => setDraft({ ...draft, maxPlaytime: e.target.value ? Number(e.target.value) : undefined })}
        />
      </label>

      <label className="filter-field">
        Not played in the last (days)
        <input
          type="number"
          min={1}
          placeholder="e.g. 30"
          value={draft.notPlayedInDays ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, notPlayedInDays: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </label>

      <label className="filter-field filter-checkbox">
        <input
          type="checkbox"
          checked={draft.includeExpansions ?? false}
          onChange={(e) => setDraft({ ...draft, includeExpansions: e.target.checked })}
        />
        Include expansions
      </label>

      {categories.length > 0 && (
        <div className="filter-field">
          Categories
          <div className="chip-list">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`chip ${draft.categories?.includes(cat) ? "chip-active" : ""}`}
                onClick={() => setDraft({ ...draft, categories: toggleFromList(draft.categories, cat) })}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {mechanics.length > 0 && (
        <div className="filter-field">
          Mechanics
          <div className="chip-list">
            {mechanics.map((mech) => (
              <button
                key={mech}
                className={`chip ${draft.mechanics?.includes(mech) ? "chip-active" : ""}`}
                onClick={() => setDraft({ ...draft, mechanics: toggleFromList(draft.mechanics, mech) })}
              >
                {mech}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="filter-actions">
        <button className="secondary-button" onClick={() => setDraft({})}>
          Clear all
        </button>
        <button
          className="primary-button"
          onClick={() => {
            onChange(draft);
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
