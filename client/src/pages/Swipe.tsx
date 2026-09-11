import { useEffect, useMemo, useRef, useState } from "react";
import TinderCard from "react-tinder-card";
import { api, type Filters, type Game, type Round } from "../api";
import FilterBar from "../components/FilterBar";
import GameCard from "../components/GameCard";

type SwipeDirection = "left" | "right" | "up" | "down";

/**
 * Games BGG rates as "best with" the current group get a head start, without excluding the rest:
 * each game draws a random key and matching games subtract a bonus, so they cluster early but
 * everything still mixes in.
 */
// 0.15 puts a best-with game first roughly 76% of the time against 50% by chance — a clear
// lean without burying everything else. Raising it much past 0.2 crowds the other games out.
const BEST_WITH_BONUS = 0.15;

function orderDeck(games: Game[], playerCount?: number): Game[] {
  const shown = games
    .map((game) => {
      const bonus = playerCount !== undefined && game.bestPlayers.includes(playerCount) ? BEST_WITH_BONUS : 0;
      return { game, key: Math.random() - bonus };
    })
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.game);

  // The stack renders the last element on top, so reverse to show `shown[0]` first.
  return shown.reverse();
}

export default function Swipe({ refreshToken, round }: { refreshToken: number; round: Round | null }) {
  const [deck, setDeck] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const cardRefs = useRef<Record<number, any>>({});

  const loadDeck = useMemo(
    () => async (currentFilters: Filters, playerCount?: number) => {
      setLoading(true);
      setError(null);
      try {
        const { games } = await api.deck(currentFilters);
        setDeck(orderDeck(games, playerCount));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load games");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // A running round sets the player-count filter, which stays adjustable in the filter panel.
  useEffect(() => {
    if (round) setFilters((prev) => ({ ...prev, playerCount: round.playerCount }));
  }, [round?.id, round?.playerCount]);

  useEffect(() => {
    loadDeck(filters, round?.playerCount);
  }, [filters, loadDeck, refreshToken, round?.playerCount]);

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
    loadDeck(filters, round?.playerCount);
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
              <GameCard game={game} playerCount={round?.playerCount} />
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
