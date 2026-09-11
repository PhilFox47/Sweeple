import { useEffect, useMemo, useState } from "react";
import { api, type Expansion, type ExpansionMode } from "../api";

const MODES: { value: ExpansionMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "hidden", label: "Hidden" },
  { value: "standalone", label: "Standalone" },
];

function range(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  if (min && max && min !== max) return `${min}–${max} players`;
  return `${min ?? max} players`;
}

/**
 * BGG marks a lot of things as expansions, including boxes that play perfectly well on their own.
 * The override lives in the database and is never touched by syncing or importing, so a choice
 * made here survives a library refresh.
 */
export default function ManageExpansions({ refreshToken }: { refreshToken: number }) {
  const [items, setItems] = useState<Expansion[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .expansions()
      .then(({ expansions }) => {
        if (cancelled) return;
        setItems(expansions);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load expansions"))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const shown = items.filter((i) => !i.hidden).length;

  async function setMode(item: Expansion, mode: ExpansionMode) {
    if (item.mode === mode) return;
    setPending(item.id);
    setError(null);
    // Optimistic: the row's own toggle is the only thing that changes, and `hidden` follows
    // from the new mode the same way the server computes it.
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, mode, hidden: mode === "hidden" || (mode === "auto" && i.isExpansion) }
          : i
      )
    );
    try {
      await api.setExpansionMode(item.id, mode);
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      setError(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel">
      <h3>Manage expansions</h3>
      <p className="panel-hint">
        Everything BoardGameGeek flags as an expansion. Mark the ones that only add to a base game as{" "}
        <strong>Hidden</strong> so they stay out of the swipe deck, and the ones you can play on their own as{" "}
        <strong>Standalone</strong>. Your choices are kept when the library is synced again.
      </p>

      {items.length > 6 && (
        <div className="inline-form">
          <input
            type="text"
            placeholder="Search expansions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {loaded && items.length === 0 && !error && (
        <p className="panel-hint">No expansions in the collection yet. Sync or import to fill the library.</p>
      )}

      {items.length > 0 && (
        <p className="panel-hint">
          {shown} of {items.length} appear in the deck.
        </p>
      )}

      <div className="expansion-rows">
        {visible.map((item) => (
          <div className={`expansion-row ${pending === item.id ? "is-busy" : ""}`} key={item.id}>
            {item.thumbnail ? (
              <img className="expansion-thumb" src={item.thumbnail} alt="" loading="lazy" />
            ) : (
              <div className="expansion-thumb expansion-thumb-empty" />
            )}
            <div className="expansion-meta">
              <span className="expansion-name">{item.name}</span>
              <span className="expansion-sub">
                {[
                  range(item.minPlayers, item.maxPlayers),
                  item.isExpansion ? "BGG: expansion" : "BGG: base game",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {/* "Auto" alone does not say which way it went, so spell the result out. */}
              <span className={`expansion-state ${item.hidden ? "is-hidden" : "is-shown"}`}>
                {item.hidden ? "Not in the swipe deck" : "In the swipe deck"}
              </span>
            </div>
            <div className="segmented">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  className={`segment ${item.mode === m.value ? "segment-active" : ""}`}
                  disabled={pending === item.id}
                  onClick={() => setMode(item, m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}
    </section>
  );
}
