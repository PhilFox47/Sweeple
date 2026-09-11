import { useEffect, useState } from "react";
import { api, type Filters } from "../api";
import { IconX } from "./icons";

export default function FilterSheet({
  filters,
  roundPlayerCount,
  onChange,
  onClose,
}: {
  filters: Filters;
  roundPlayerCount?: number;
  onChange: (filters: Filters) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<string[]>([]);
  const [mechanics, setMechanics] = useState<string[]>([]);
  const [draft, setDraft] = useState<Filters>(filters);

  useEffect(() => {
    api.categories().then((r) => setCategories(r.categories)).catch(() => {});
    api.mechanics().then((r) => setMechanics(r.mechanics)).catch(() => {});
  }, []);

  function toggleIn(list: string[] | undefined, value: string): string[] {
    const current = list ?? [];
    return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  }

  const num = (v: string) => (v ? Number(v) : undefined);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Filters">
        <div className="sheet-grip" />
        <div className="sheet-header">
          <h3>Filters</h3>
          <button className="btn btn-quiet" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        <div className="sheet-body">
          <div className="field">
            <label htmlFor="f-players">Player count</label>
            <input
              id="f-players"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={roundPlayerCount ? `${roundPlayerCount} (this round)` : "Any"}
              value={draft.playerCount ?? ""}
              onChange={(e) => setDraft({ ...draft, playerCount: num(e.target.value) })}
            />
          </div>

          <div className="field">
            <label>Weight</label>
            <div className="field-pair">
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={1}
                max={5}
                placeholder="min"
                value={draft.weightMin ?? ""}
                onChange={(e) => setDraft({ ...draft, weightMin: num(e.target.value) })}
              />
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={1}
                max={5}
                placeholder="max"
                value={draft.weightMax ?? ""}
                onChange={(e) => setDraft({ ...draft, weightMax: num(e.target.value) })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="f-time">Max playtime (minutes)</label>
            <input
              id="f-time"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="Any"
              value={draft.maxPlaytime ?? ""}
              onChange={(e) => setDraft({ ...draft, maxPlaytime: num(e.target.value) })}
            />
          </div>

          <div className="field">
            <label htmlFor="f-stale">Not played in the last … days</label>
            <input
              id="f-stale"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="Any"
              value={draft.notPlayedInDays ?? ""}
              onChange={(e) => setDraft({ ...draft, notPlayedInDays: num(e.target.value) })}
            />
          </div>

          <div className="switch-row">
            <span>Include expansions</span>
            <button
              className={`chip ${draft.includeExpansions ? "chip-active" : ""}`}
              onClick={() => setDraft({ ...draft, includeExpansions: !draft.includeExpansions })}
            >
              {draft.includeExpansions ? "On" : "Off"}
            </button>
          </div>

          {categories.length > 0 && (
            <div className="field">
              <label>Categories</label>
              <div className="chip-list">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    className={`chip ${draft.categories?.includes(cat) ? "chip-active" : ""}`}
                    onClick={() => setDraft({ ...draft, categories: toggleIn(draft.categories, cat) })}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mechanics.length > 0 && (
            <div className="field">
              <label>Mechanics</label>
              <div className="chip-list">
                {mechanics.map((mech) => (
                  <button
                    key={mech}
                    className={`chip ${draft.mechanics?.includes(mech) ? "chip-active" : ""}`}
                    onClick={() => setDraft({ ...draft, mechanics: toggleIn(draft.mechanics, mech) })}
                  >
                    {mech}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sheet-footer">
          <button
            className="btn btn-ghost"
            onClick={() => setDraft(roundPlayerCount ? { playerCount: roundPlayerCount } : {})}
          >
            Clear
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            Show games
          </button>
        </div>
      </div>
    </>
  );
}
