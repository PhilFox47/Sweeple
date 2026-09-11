import { useState } from "react";
import type { Game } from "../api";

function playerRange(game: Game): string {
  if (!game.minPlayers && !game.maxPlayers) return "? players";
  if (game.minPlayers === game.maxPlayers) return `${game.minPlayers} players`;
  return `${game.minPlayers ?? "?"}–${game.maxPlayers ?? "?"} players`;
}

function weightLabel(weight: number | null): string {
  if (weight === null) return "Weight ?";
  return `Weight ${weight.toFixed(1)}/5`;
}

export default function GameCard({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);
  // An <img> rather than a CSS background: BGG image URLs contain parentheses
  // (…/filters:format(jpeg)/…), which an unquoted url() cannot express.
  const src = game.image ?? game.thumbnail;

  return (
    <div className="game-card">
      <div className="game-card-image">
        {src && !failed ? (
          <img src={src} alt={game.name} draggable={false} onError={() => setFailed(true)} />
        ) : (
          <div className="game-card-image-fallback">{game.name}</div>
        )}
      </div>
      <div className="game-card-info">
        <h2>{game.name}</h2>
        <div className="game-card-tags">
          <span>{playerRange(game)}</span>
          {game.playingTime ? <span>{game.playingTime} min</span> : null}
          <span>{weightLabel(game.weight)}</span>
        </div>
        {game.categories.length > 0 && (
          <div className="game-card-categories">{game.categories.slice(0, 4).join(" · ")}</div>
        )}
        {game.lastPlayedAt && (
          <div className="game-card-last-played">Last played {new Date(game.lastPlayedAt).toLocaleDateString()}</div>
        )}
      </div>
    </div>
  );
}
