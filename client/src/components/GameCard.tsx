import { useState } from "react";
import type { Game } from "../api";

/** Compresses [2,3,4,6] into "2–4, 6" so the line stays short on a phone. */
function formatCounts(counts: number[]): string {
  const sorted = [...counts].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    runs.push(end > i + 0 ? `${sorted[i]}–${sorted[end]}` : String(sorted[i]));
    i = end + 1;
  }
  return runs.join(", ");
}

function playerRange(game: Game): string {
  if (!game.minPlayers && !game.maxPlayers) return "Player count unknown";
  if (game.minPlayers === game.maxPlayers) return `${game.minPlayers} players`;
  return `${game.minPlayers ?? "?"}–${game.maxPlayers ?? "?"} players`;
}

function playtime(game: Game): string | null {
  if (game.playingTime) return `${game.playingTime} min`;
  if (game.minPlaytime && game.maxPlaytime) return `${game.minPlaytime}–${game.maxPlaytime} min`;
  return null;
}

/** BGG weight runs 1–5. Green is a filler, red is a brain burner. */
function weightClass(weight: number): string {
  if (weight < 1.8) return "weight-1";
  if (weight < 2.6) return "weight-2";
  if (weight < 3.4) return "weight-3";
  if (weight < 4.2) return "weight-4";
  return "weight-5";
}

function lastPlayedLabel(game: Game): string {
  if (!game.lastPlayedAt) return game.numPlays > 0 ? `Played ${game.numPlays}×` : "Never played";
  const days = Math.floor((Date.now() - new Date(game.lastPlayedAt).getTime()) / 86_400_000);
  const when =
    days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : new Date(game.lastPlayedAt).toLocaleDateString();
  return `Last played ${when}`;
}

export default function GameCard({ game, playerCount }: { game: Game; playerCount?: number }) {
  const [failed, setFailed] = useState(false);
  // An <img> rather than a CSS background: BGG image URLs contain parentheses
  // (…/filters:format(jpeg)/…), which an unquoted url() cannot express.
  const src = game.image ?? game.thumbnail;
  const tags = [...game.categories, ...game.mechanics].slice(0, 3);
  const time = playtime(game);
  const isBestForGroup = playerCount !== undefined && game.bestPlayers.includes(playerCount);

  return (
    <div className="game-card">
      <div className="game-card-image">
        {src && !failed ? (
          <img src={src} alt={game.name} draggable={false} onError={() => setFailed(true)} />
        ) : (
          // The title already sits over the art, so the placeholder must not repeat the name.
          <div className="game-card-image-fallback" aria-hidden="true">
            🎲
          </div>
        )}
        <div className="game-card-title">
          <h2>{game.name}</h2>
        </div>
      </div>

      <div className="game-card-info">
        <div className={`game-card-best ${isBestForGroup ? "best-match" : ""}`}>
          {game.bestPlayers.length > 0 ? (
            <>
              Best with <strong>{formatCounts(game.bestPlayers)}</strong>{" "}
              {isBestForGroup && <span className="best-badge">perfect for tonight</span>}
            </>
          ) : (
            <span className="game-card-muted">No player-count rating yet</span>
          )}
        </div>

        <div className="game-card-range">{playerRange(game)}</div>

        <div className="game-card-stats">
          <span>{time ?? "Playtime unknown"}</span>
          <span className="game-card-dot">·</span>
          {game.weight !== null ? (
            <span>
              Weight <strong className={weightClass(game.weight)}>{game.weight.toFixed(1)}</strong>
            </span>
          ) : (
            <span className="game-card-muted">Weight unknown</span>
          )}
        </div>

        {tags.length > 0 && (
          <div className="game-card-tags">
            {tags.map((tag) => (
              <span className="game-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="game-card-last-played">{lastPlayedLabel(game)}</div>
      </div>
    </div>
  );
}
