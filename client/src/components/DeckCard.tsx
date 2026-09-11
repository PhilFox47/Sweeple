import { memo, useCallback, useState } from "react";
import TinderCard from "react-tinder-card";
import type { Game } from "../api";
import GameCard from "./GameCard";

export type SwipeDirection = "left" | "right" | "up" | "down";

/**
 * react-tinder-card rebuilds its drag listeners whenever any of its callback props change
 * identity, and that rebuild resets the gesture origin mid-drag, snapping the card back to the
 * centre. So every prop handed to it below must be referentially stable, this array included —
 * an inline ["up","down"] would be a new value on each render.
 */
const PREVENT_SWIPE: string[] = ["up", "down"];

interface Props {
  game: Game;
  depth: number;
  playerCount?: number;
  /** Must be stable across renders. */
  onDecision: (game: Game, direction: SwipeDirection) => void;
  /** Must be stable across renders. */
  registerRef: (id: number, el: unknown) => void;
}

function DeckCardImpl({ game, depth, playerCount, onDecision, registerRef }: Props) {
  // Kept per card so showing a stamp re-renders only this card, never the whole deck.
  const [stamp, setStamp] = useState<"left" | "right" | null>(null);

  const setRef = useCallback((el: unknown) => registerRef(game.id, el), [registerRef, game.id]);

  const handleSwipe = useCallback(
    (dir: string) => {
      setStamp(null);
      onDecision(game, dir as SwipeDirection);
    },
    [game, onDecision]
  );

  const handleFulfilled = useCallback((dir: string) => {
    if (dir === "left" || dir === "right") setStamp(dir);
  }, []);

  const handleUnfulfilled = useCallback(() => setStamp(null), []);

  return (
    <TinderCard
      ref={setRef as never}
      className="deck-card"
      onSwipe={handleSwipe}
      preventSwipe={PREVENT_SWIPE}
      swipeRequirementType="position"
      swipeThreshold={90}
      onSwipeRequirementFulfilled={handleFulfilled}
      onSwipeRequirementUnfulfilled={handleUnfulfilled}
    >
      <div
        className="deck-card-inner"
        style={{
          // Cards behind sit slightly back for depth.
          transform: `scale(${1 - depth * 0.035}) translateY(${depth * 12}px)`,
        }}
      >
        <GameCard game={game} playerCount={playerCount} stamp={stamp} eager={depth < 2} />
      </div>
    </TinderCard>
  );
}

export default memo(DeckCardImpl);
