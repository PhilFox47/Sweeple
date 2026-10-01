import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ExpansionMode, type GameRating, type LibraryGame } from "../api";
import SummaryEditor from "./SummaryEditor";

function range(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  if (min && max && min !== max) return `${min}–${max} Spieler`;
  return `${min ?? max} Spieler`;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Enough votes to mean something, and picked rarely enough to be worth a look. */
const UNPOPULAR_VOTES = 3;
const UNPOPULAR_RATIO = 0.34;

function rateClass(ratio: number): string {
  if (ratio <= UNPOPULAR_RATIO) return "rate-low";
  if (ratio >= 0.66) return "rate-high";
  return "rate-mid";
}

function PickRating({ rating }: { rating: GameRating }) {
  if (rating.total === 0) return <span className="library-rating is-empty">Noch keine Stimmen</span>;
  return (
    <span className="library-rating">
      <span className={`rate ${rateClass(rating.ratio ?? 0)}`}>{pct(rating.ratio ?? 0)} gewollt</span>
      <span className="rate-total">
        {rating.total} {rating.total === 1 ? "Stimme" : "Stimmen"}
      </span>
      {rating.byPlayer.map((p) => (
        <span className="rate-player" key={p.id}>
          {p.displayName} {pct(p.likes / p.total)} ({p.total})
        </span>
      ))}
    </span>
  );
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
  const [editing, setEditing] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  // After an edit the server decides what shows (hand-written, translation or BGG's English).
  const reload = useCallback(() => {
    api
      .library()
      .then(({ games }) => setGames(games))
      .catch((err) => setError(err instanceof Error ? err.message : "Die Bibliothek konnte nicht geladen werden"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .library()
      .then(({ games }) => {
        if (cancelled) return;
        setGames(games);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Die Bibliothek konnte nicht geladen werden"))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const search = query.trim().toLowerCase();

  const groups = useMemo<Group[]>(() => {
    if (search) {
      return [{ key: "search", title: "Suchergebnisse", games: games.filter((g) => g.name.toLowerCase().includes(search)) }];
    }

    const out: Group[] = [];

    // The point of tracking picks: the games that keep getting turned down, gathered up so they
    // can be hidden in one pass. They also stay in their own section below.
    const unpopular = games
      .filter((g) => !g.hidden && g.rating.total >= UNPOPULAR_VOTES && (g.rating.ratio ?? 1) <= UNPOPULAR_RATIO)
      .sort((a, b) => (a.rating.ratio ?? 1) - (b.rating.ratio ?? 1));
    if (unpopular.length) {
      out.push({
        key: "unpopular",
        title: "Selten gewollt",
        hint: "meistens abgelehnt",
        games: unpopular,
      });
    }

    const bySeries = new Map<string, LibraryGame[]>();
    for (const game of games) {
      if (!game.series) continue;
      const list = bySeries.get(game.series) ?? [];
      list.push(game);
      bySeries.set(game.series, list);
    }
    for (const [title, list] of [...bySeries].sort((a, b) => a[0].localeCompare(b[0]))) {
      const inDeck = list.filter((g) => !g.hidden).length;
      out.push({ key: `series:${title}`, title, hint: `${inDeck} von ${list.length} im Stapel`, games: list });
    }

    const loose = games.filter((g) => !g.series);
    const expansions = loose.filter((g) => g.isExpansion || g.mode !== "auto");
    if (expansions.length) {
      out.push({ key: "expansions", title: "Erweiterungen", hint: "laut BoardGameGeek", games: expansions });
    }

    const rest = loose.filter((g) => !expansions.includes(g));
    if (rest.length) {
      out.push({ key: "rest", title: "Alles andere", hint: `${rest.length} Spiele`, games: showAll ? rest : [] });
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
      setError(err instanceof Error ? err.message : "Das konnte nicht gespeichert werden");
    } finally {
      setPending(null);
    }
  }

  const hiddenCount = games.filter((g) => g.hidden).length;

  return (
    <section className="panel">
      <h3>Was im Stapel landet</h3>
      <p className="panel-hint">
        Blende aus, was nie ausgeteilt werden soll: Erweiterungen, die nur ein Grundspiel ergänzen,
        und die weiteren Boxen einer Reihe wie Villainous oder Dice Throne — eine behalten, den Rest
        ausblenden. Tippe auf ein Spiel, um seine Kurzbeschreibung zu bearbeiten. Deine Auswahl
        bleibt beim nächsten Abgleich erhalten.
      </p>

      <div className="inline-form">
        <input type="text" placeholder="Spiele suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loaded && games.length === 0 && !error && (
        <p className="panel-hint">Die Bibliothek ist leer. Gleiche mit BGG ab oder importiere deine Sammlung.</p>
      )}
      {games.length > 0 && (
        <p className="panel-hint library-summary">
          {games.length - hiddenCount} von {games.length} Spielen können ausgeteilt werden.
        </p>
      )}

      {groups.map((group) => (
        <div className="library-group" key={group.key}>
          <div className="library-group-head">
            <span className="library-group-title">{group.title}</span>
            {group.hint && <span className="library-group-hint">{group.hint}</span>}
            {group.key === "rest" && (
              <button className="btn-quiet library-toggle" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Einklappen" : "Zeigen"}
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
              <button
                className="library-meta"
                onClick={() => setEditing((id) => (id === game.id ? null : game.id))}
                aria-expanded={editing === game.id}
              >
                <span className="library-name">
                  {game.name}
                  {!game.summary && <span className="no-summary" title="Keine Kurzbeschreibung"> · ohne Text</span>}
                </span>
                <span className="library-sub">
                  {[range(game.minPlayers, game.maxPlayers), game.isExpansion ? "BGG: Erweiterung" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <PickRating rating={game.rating} />
              </button>
              <div className="segmented">
                <button
                  className={`segment ${game.hidden ? "" : "segment-active"}`}
                  disabled={pending === game.id}
                  onClick={() => setMode(game, "standalone")}
                >
                  Im Stapel
                </button>
                <button
                  className={`segment ${game.hidden ? "segment-active segment-off" : ""}`}
                  disabled={pending === game.id}
                  onClick={() => setMode(game, "hidden")}
                >
                  Ausgeblendet
                </button>
              </div>
              {editing === game.id && (
                <SummaryEditor game={game} onSaved={reload} />
              )}
            </div>
          ))}

          {group.games.length === 0 && group.key !== "rest" && <p className="panel-hint">Nichts hier.</p>}
        </div>
      ))}

      {search && groups[0]?.games.length === 0 && <p className="panel-hint">Kein Spiel passt zu „{query}“.</p>}

      {error && <div className="form-error">{error}</div>}
    </section>
  );
}
