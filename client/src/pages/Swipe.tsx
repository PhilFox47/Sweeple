import { useCallback, useEffect, useRef, useState } from "react";
import TinderCard from "react-tinder-card";
import { api, type Filters, type Game, type Round } from "../api";
import FilterSheet from "../components/FilterSheet";
import GameCard from "../components/GameCard";
import { IconHeartFilled, IconSliders, IconX } from "../components/icons";

type SwipeDirection = "left" | "right" | "up" | "down";

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

export default function Swipe({ refreshToken, round }: { refreshToken: number; round: Round | null }) {
  const [deck, setDeck] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [stamp, setStamp] = useState<"left" | "right" | null>(null);
  const cardRefs = useRef<Record<number, any>>({});

  const loadDeck = useCallback(async (currentFilters: Filters, playerCount?: number) => {
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
  }, []);

  // A running round sets the player-count filter, which stays adjustable in the sheet.
  useEffect(() => {
    if (round) setFilters((prev) => ({ ...prev, playerCount: round.playerCount }));
  }, [round?.id, round?.playerCount]);

  useEffect(() => {
    loadDeck(filters, round?.playerCount);
  }, [filters, loadDeck, refreshToken, round?.playerCount]);

  async function handleDecision(game: Game, direction: SwipeDirection) {
    setStamp(null);
    if (direction !== "left" && direction !== "right") return;
    const decision = direction === "right" ? "like" : "dislike";
    setDeck((prev) => prev.filter((g) => g.id !== game.id));
    try {
      await api.swipe(game.id, decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record swipe");
    }
  }

  function swipeTop(direction: "left" | "right") {
    const top = deck[0];
    if (!top) return;
    cardRefs.current[top.id]?.swipe(direction);
  }

  async function handleReset() {
    if (!confirm("Start your swipes over? Games you already decided on come back into the deck.")) return;
    await api.resetSwipes();
    loadDeck(filters, round?.playerCount);
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
        {loading && <div className="skeleton-card" />}

        {!loading && deck.length === 0 && (
          <div className="empty-state">
            <div className="empty-emoji">🎲</div>
            <h3>Nothing left to swipe</h3>
            <p>Adjust the filters, start over, or sync your collection from Settings.</p>
          </div>
        )}

        {!loading &&
          stackOrder.map((game) => {
            const depth = visible.indexOf(game);
            const isTop = depth === 0;
            return (
              <TinderCard
                ref={(el) => {
                  cardRefs.current[game.id] = el;
                }}
                key={game.id}
                className="deck-card"
                onSwipe={(dir) => handleDecision(game, dir as SwipeDirection)}
                preventSwipe={["up", "down"]}
                swipeRequirementType="position"
                swipeThreshold={90}
                onSwipeRequirementFulfilled={(dir) => {
                  if (isTop && (dir === "left" || dir === "right")) setStamp(dir);
                }}
                onSwipeRequirementUnfulfilled={() => isTop && setStamp(null)}
              >
                <div
                  className="deck-card-inner"
                  style={{
                    // Cards behind sit slightly back for depth.
                    transform: `scale(${1 - depth * 0.035}) translateY(${depth * 12}px)`,
                  }}
                >
                  <GameCard
                    game={game}
                    playerCount={round?.playerCount}
                    stamp={isTop ? stamp : null}
                    eager={depth < 2}
                  />
                </div>
              </TinderCard>
            );
          })}
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
          filters={filters}
          roundPlayerCount={round?.playerCount}
          onChange={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}
