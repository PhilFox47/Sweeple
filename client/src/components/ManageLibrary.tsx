import { useEffect, useMemo, useState } from "react";
import { api, type ExpansionMode, type LibraryGame } from "../api";

function range(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  if (min && max && min !== max) return `${min}–${max} players`;
  return `${min ?? max} players`;
}

interface Group {
  key: string;
  title: string;
  hint?: string;
  games: LibraryGame[];
}

/**
 * Which boxes turn up in the swipe deck. Two problems share this screen: expansions BGG flagged,
 * which should mostly stay out, and series where BGG calls every box a standalone base game —
 * Villainous, Dice Throne — so a single game fills the deck with near-duplicates. Both come down
 * to one choice per box, so both are made here.
 *
 * The override is stored per game and never written by syncing or importing, so it survives a
 * library refresh.
 */
export default function ManageLibrary({ refreshToken }: { refreshToken: number }) {
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .library()
      .then(({ games }) => {
        if (cancelled) return;
        setGames(games);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the library"))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const search = query.trim().toLowerCase();

  const groups = useMemo<Group[]>(() => {
    if (search) {
      return [{ key: "search", title: "Search results", games: games.filter((g) => g.name.toLowerCase().includes(search)) }];
    }

    const out: Group[] = [];
    const bySeries = new Map<string, LibraryGame[]>();
    for (const game of games) {
      if (!game.series) continue;
      const list = bySeries.get(game.series) ?? [];
      list.push(game);
      bySeries.set(game.series, list);
    }
    for (const [title, list] of [...bySeries].sort((a, b) => a[0].localeCompare(b[0]))) {
      const inDeck = list.filter((g) => !g.hidden).length;
      out.push({ key: `series:${title}`, title, hint: `${inDeck} of ${list.length} in the deck`, games: list });
    }

    const loose = games.filter((g) => !g.series);
    const expansions = loose.filter((g) => g.isExpansion || g.mode !== "auto");
    if (expansions.length) {
      out.push({ key: "expansions", title: "Expansions", hint: "Flagged by BoardGameGeek", games: expansions });
    }

    const rest = loose.filter((g) => !expansions.includes(g));
    if (rest.length) {
      out.push({ key: "rest", title: "Everything else", hint: `${rest.length} games`, games: showAll ? rest : [] });
    }
    return out;
  }, [games, search, showAll]);

  async function setMode(game: LibraryGame, mode: ExpansionMode) {
    if (game.mode === mode) return;
    setPending(game.id);
    setError(null);
    // Optimistic: `hidden` follows from the new mode exactly the way the server computes it.
    setGames((prev) =>
      prev.map((g) =>
        g.id === game.id ? { ...g, mode, hidden: mode === "hidden" || (mode === "auto" && g.isExpansion) } : g
      )
    );
    try {
      await api.setGameVisibility(game.id, mode);
    } catch (err) {
      setGames((prev) => prev.map((g) => (g.id === game.id ? game : g)));
      setError(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setPending(null);
    }
  }

  const hiddenCount = games.filter((g) => g.hidden).length;

  return (
    <section className="panel">
      <h3>What shows up when swiping</h3>
      <p className="panel-hint">
        Hide the boxes you never want dealt: expansions that only add to a base game, and the extra
        versions of a series like Villainous or Dice Throne — keep one, hide the rest. Your choices
        are kept when the library is synced again.
      </p>

      <div className="inline-form">
        <input type="text" placeholder="Search games" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loaded && games.length === 0 && !error && (
        <p className="panel-hint">The library is empty. Sync or import to fill it.</p>
      )}
      {games.length > 0 && (
        <p className="panel-hint library-summary">
          {games.length - hiddenCount} of {games.length} games can show up when swiping.
        </p>
      )}

      {groups.map((group) => (
        <div className="library-group" key={group.key}>
          <div className="library-group-head">
            <span className="library-group-title">{group.title}</span>
            {group.hint && <span className="library-group-hint">{group.hint}</span>}
            {group.key === "rest" && (
              <button className="btn-quiet library-toggle" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Hide" : "Show"}
              </button>
            )}
          </div>

          {group.games.map((game) => (
            <div className={`library-row ${pending === game.id ? "is-busy" : ""}`} key={game.id}>
              {game.thumbnail ? (
                <img className="library-thumb" src={game.thumbnail} alt="" loading="lazy" />
              ) : (
                <div className="library-thumb library-thumb-empty" />
              )}
              <div className="library-meta">
                <span className="library-name">{game.name}</span>
                <span className="library-sub">
                  {[range(game.minPlayers, game.maxPlayers), game.isExpansion ? "BGG: expansion" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="segmented">
                <button
                  className={`segment ${game.hidden ? "" : "segment-active"}`}
                  disabled={pending === game.id}
                  onClick={() => setMode(game, "standalone")}
                >
                  In deck
                </button>
                <button
                  className={`segment ${game.hidden ? "segment-active segment-off" : ""}`}
                  disabled={pending === game.id}
                  onClick={() => setMode(game, "hidden")}
                >
                  Hidden
                </button>
              </div>
            </div>
          ))}

          {group.games.length === 0 && group.key !== "rest" && <p className="panel-hint">Nothing here.</p>}
        </div>
      ))}

      {search && groups[0]?.games.length === 0 && <p className="panel-hint">No game matches “{query}”.</p>}

      {error && <div className="form-error">{error}</div>}
    </section>
  );
}
