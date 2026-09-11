import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Filters, type Game, type Round } from "../api";
import DeckCard, { type SwipeDirection } from "../components/DeckCard";
import FilterSheet from "../components/FilterSheet";
import { IconHeartFilled, IconSliders, IconX } from "../components/icons";

/**
 * Only a few cards are mounted at a time. Rendering the whole deck meant ~80 animated card
 * instances and ~80 full-size BGG images racing each other, which is what made the UI crawl
 * and left images half-loaded.
 */
const VISIBLE_CARDS = 3;

/**
 * Games BGG rates as "best with" the current group get a head start, without excluding the rest:
 * each game draws a random key and matching games subtract a bonus, so they cluster early but
 * everything still mixes in. 0.15 puts one first ~70% of the time against 50% by chance;
 * much past 0.2 and the other games stop showing up.
 */
const BEST_WITH_BONUS = 0.15;

function orderDeck(games: Game[], playerCount?: number): Game[] {
  return games
    .map((game) => {
      const bonus = playerCount !== undefined && game.bestPlayers.includes(playerCount) ? BEST_WITH_BONUS : 0;
      return { game, key: Math.random() - bonus };
    })
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.game);
}

export default function Swipe({
  refreshToken,
  round,
}: {
  refreshToken: number;
  /** undefined while the round is still loading — fetching before then races the filter in. */
  round: Round | null | undefined;
}) {
  const [deck, setDeck] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const cardRefs = useRef<Record<number, any>>({});
  // Responses can land out of order; only the newest request may write the deck.
  const requestId = useRef(0);

  /**
   * The round's size is the default player count, overridable in the filter sheet. Derived in
   * one place rather than copied into filter state, so there is never a moment where the deck
   * is fetched without it.
   */
  const effectiveFilters: Filters = useMemo(
    () => ({ ...filters, playerCount: filters.playerCount ?? round?.playerCount }),
    [filters, round?.playerCount]
  );

  const loadDeck = useCallback(async (currentFilters: Filters) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const { games } = await api.deck(currentFilters);
      if (id !== requestId.current) return;
      setDeck(orderDeck(games, currentFilters.playerCount));
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Failed to load games");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait for the round to resolve, otherwise the first fetch goes out unfiltered.
    if (round === undefined) return;
    loadDeck(effectiveFilters);
  }, [effectiveFilters, loadDeck, refreshToken, round]);

  // Stable so the cards never rebuild their drag listeners: doing so mid-gesture resets the
  // drag origin and the card jumps back to the centre.
  const handleDecision = useCallback(async (game: Game, direction: SwipeDirection) => {
    if (direction !== "left" && direction !== "right") return;
    const decision = direction === "right" ? "like" : "dislike";
    setDeck((prev) => prev.filter((g) => g.id !== game.id));
    try {
      await api.swipe(game.id, decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record swipe");
    }
  }, []);

  const registerRef = useCallback((id: number, el: unknown) => {
    cardRefs.current[id] = el;
  }, []);

  function swipeTop(direction: "left" | "right") {
    const top = deck[0];
    if (!top) return;
    cardRefs.current[top.id]?.swipe(direction);
  }

  async function handleReset() {
    if (!confirm("Start your swipes over? Games you already decided on come back into the deck.")) return;
    await api.resetSwipes();
    loadDeck(effectiveFilters);
  }

  // deck[0] is the card on top, so render the first few reversed: last in DOM paints highest.
  const visible = deck.slice(0, VISIBLE_CARDS);
  const stackOrder = [...visible].reverse();

  return (
    <div className="swipe-screen">
      <div className="swipe-toolbar">
        <button className="btn btn-ghost" onClick={() => setShowFilters(true)}>
          <IconSliders />
          Filters
        </button>
        <button className="btn btn-quiet" onClick={handleReset}>
          Start over
        </button>
        {!loading && deck.length > 0 && <span className="deck-count">{deck.length} left</span>}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="deck">
        {(loading || round === undefined) && <div className="skeleton-card" />}

        {!loading && round !== undefined && deck.length === 0 && (
          <div className="empty-state">
            <div className="empty-emoji">🎲</div>
            <h3>Nothing left to swipe</h3>
            <p>Adjust the filters, start over, or sync your collection from Settings.</p>
          </div>
        )}

        {!loading &&
          round !== undefined &&
          stackOrder.map((game) => (
            <DeckCard
              key={game.id}
              game={game}
              depth={visible.indexOf(game)}
              playerCount={round?.playerCount}
              onDecision={handleDecision}
              registerRef={registerRef}
            />
          ))}
      </div>

      <div className="deck-controls">
        <button
          className="circle-btn nope"
          onClick={() => swipeTop("left")}
          disabled={loading || deck.length === 0}
          aria-label="Not tonight"
        >
          <IconX />
        </button>
        <button
          className="circle-btn like big"
          onClick={() => swipeTop("right")}
          disabled={loading || deck.length === 0}
          aria-label="Would play"
        >
          <IconHeartFilled />
        </button>
      </div>

      {showFilters && (
        <FilterSheet
          filters={effectiveFilters}
          roundPlayerCount={round?.playerCount}
          onChange={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}
