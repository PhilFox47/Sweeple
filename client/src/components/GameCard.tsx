import { useState } from "react";
import type { Game } from "../api";
import { IconSparkle, IconUsers } from "./icons";

/** Compresses [2,3,4,6] into "2–4, 6" so the line stays short on a phone. */
function formatCounts(counts: number[]): string {
  const sorted = [...counts].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    runs.push(end > i ? `${sorted[i]}–${sorted[end]}` : String(sorted[i]));
    i = end + 1;
  }
  return runs.join(", ");
}

function playerRange(game: Game): string {
  if (!game.minPlayers && !game.maxPlayers) return "? players";
  if (game.minPlayers === game.maxPlayers) return `${game.minPlayers} players`;
  return `${game.minPlayers ?? "?"}–${game.maxPlayers ?? "?"} players`;
}

function playtime(game: Game): string | null {
  if (game.minPlaytime && game.maxPlaytime && game.minPlaytime !== game.maxPlaytime) {
    return `${game.minPlaytime}–${game.maxPlaytime} min`;
  }
  if (game.playingTime) return `${game.playingTime} min`;
  return null;
}

/** BGG weight runs 1–5: green is a filler, red is a brain burner. */
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
  if (days <= 0) return "Played today";
  if (days === 1) return "Played yesterday";
  if (days < 30) return `Last played ${days} days ago`;
  if (days < 365) return `Last played ${Math.round(days / 30)} months ago`;
  return `Last played ${new Date(game.lastPlayedAt).toLocaleDateString()}`;
}

export default function GameCard({
  game,
  playerCount,
  stamp,
  eager,
}: {
  game: Game;
  playerCount?: number;
  stamp?: "left" | "right" | null;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // An <img> rather than a CSS background: BGG image URLs contain parentheses
  // (…/filters:format(jpeg)/…), which an unquoted url() cannot express.
  const src = game.image ?? game.thumbnail;
  const tags = [...game.categories, ...game.mechanics].slice(0, 3);
  const time = playtime(game);
  const isIdeal = playerCount !== undefined && game.bestPlayers.includes(playerCount);

  return (
    <div className="game-card">
      <div className="card-art">
        {src && !failed ? (
          <img
            src={src}
            alt=""
            draggable={false}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="card-art-fallback" aria-hidden="true">
            🎲
          </div>
        )}
      </div>
      <div className="card-scrim" />

      <div className={`stamp stamp-like ${stamp === "right" ? "is-on" : ""}`}>LIKE</div>
      <div className={`stamp stamp-nope ${stamp === "left" ? "is-on" : ""}`}>NOPE</div>

      <div className="card-body">
        <h2 className="card-title">
          {game.name}
          {game.yearPublished ? <span className="card-year"> · {game.yearPublished}</span> : null}
        </h2>

        <div className="best-row">
          {game.bestPlayers.length > 0 ? (
            <span className={`best-pill ${isIdeal ? "is-ideal" : ""}`}>
              {isIdeal ? <IconSparkle /> : <IconUsers />}
              Best with {formatCounts(game.bestPlayers)}
            </span>
          ) : (
            <span className="best-pill">
              <IconUsers />
              No player rating yet
            </span>
          )}
          {isIdeal && <span className="ideal-note">ideal tonight</span>}
        </div>

        <div className="card-stats">
          <span>{playerRange(game)}</span>
          <i className="sep" />
          <span>{time ?? "? min"}</span>
          <i className="sep" />
          {game.weight !== null ? (
            <span>
              Weight <span className={`weight-value ${weightClass(game.weight)}`}>{game.weight.toFixed(1)}</span>
            </span>
          ) : (
            <span>Weight ?</span>
          )}
        </div>

        {tags.length > 0 && (
          <div className="card-tags">
            {tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="card-played">{lastPlayedLabel(game)}</div>
      </div>
    </div>
  );
}
