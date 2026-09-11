import { useEffect, useMemo, useRef, useState } from "react";
import TinderCard from "react-tinder-card";
import { api, type Filters, type Game } from "../api";
import FilterBar from "../components/FilterBar";
import GameCard from "../components/GameCard";

type SwipeDirection = "left" | "right" | "up" | "down";

export default function Swipe({ refreshToken }: { refreshToken: number }) {
  const [deck, setDeck] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const cardRefs = useRef<Record<number, any>>({});

  const loadDeck = useMemo(
    () => async (currentFilters: Filters) => {
      setLoading(true);
      setError(null);
      try {
        const { games } = await api.deck(currentFilters);
        setDeck(games);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load games");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadDeck(filters);
  }, [filters, loadDeck, refreshToken]);

  async function handleDecision(game: Game, direction: SwipeDirection) {
    if (direction !== "left" && direction !== "right") return;
    const decision = direction === "right" ? "like" : "dislike";
    try {
      await api.swipe(game.id, decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record swipe");
    }
    setDeck((prev) => prev.filter((g) => g.id !== game.id));
  }

  function swipeTop(direction: "left" | "right") {
    const top = deck[deck.length - 1];
    if (!top) return;
    cardRefs.current[top.id]?.swipe(direction);
  }

  async function handleReset() {
    if (!confirm("Reset your swipe decisions? Games you already liked or disliked will come back into the deck.")) {
      return;
    }
    await api.resetSwipes();
    loadDeck(filters);
  }

  return (
    <div className="swipe-page">
      <div className="swipe-toolbar">
        <button className="secondary-button" onClick={() => setShowFilters(true)}>
          Filters
        </button>
        <button className="secondary-button" onClick={handleReset}>
          Reset my swipes
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="card-stack">
        {loading && <div className="empty-state">Loading your games…</div>}
        {!loading && deck.length === 0 && (
          <div className="empty-state">
            <p>No games left to swipe on.</p>
            <p>Try adjusting your filters, resetting your swipes, or syncing with BGG.</p>
          </div>
        )}
        {!loading &&
          deck.map((game) => (
            <TinderCard
              ref={(el) => {
                cardRefs.current[game.id] = el;
              }}
              key={game.id}
              onSwipe={(dir) => handleDecision(game, dir as SwipeDirection)}
              preventSwipe={["up", "down"]}
              className="tinder-card"
            >
              <GameCard game={game} />
            </TinderCard>
          ))}
      </div>

      {!loading && deck.length > 0 && (
        <div className="swipe-actions">
          <button className="round-button dislike" onClick={() => swipeTop("left")} aria-label="Dislike">
            ✕
          </button>
          <button className="round-button like" onClick={() => swipeTop("right")} aria-label="Like">
            ♥
          </button>
        </div>
      )}

      {showFilters && <FilterBar filters={filters} onChange={setFilters} onClose={() => setShowFilters(false)} />}
    </div>
  );
}
