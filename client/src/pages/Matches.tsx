import { useEffect, useState } from "react";
import { api, type Match } from "../api";

export default function Matches({ refreshToken }: { refreshToken: number }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { matches } = await api.matches();
      setMatches(matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load matches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [refreshToken]);

  async function markPlayed(matchId: number) {
    await api.markPlayed(matchId);
    load();
  }

  const pending = matches.filter((m) => !m.playedAt);
  const played = matches.filter((m) => m.playedAt);

  if (loading) return <div className="empty-state">Loading matches…</div>;

  return (
    <div className="matches-page">
      {error && <div className="form-error">{error}</div>}

      <h2>Ready to play</h2>
      {pending.length === 0 && <div className="empty-state">No matches yet — keep swiping together!</div>}
      <div className="match-list">
        {pending.map((match) => (
          <div className="match-card" key={match.id}>
            {match.thumbnail && <img src={match.thumbnail} alt={match.name} />}
            <div className="match-card-info">
              <h3>{match.name}</h3>
              <div className="game-card-tags">
                {match.minPlayers && match.maxPlayers && (
                  <span>
                    {match.minPlayers}–{match.maxPlayers} players
                  </span>
                )}
                {match.playingTime && <span>{match.playingTime} min</span>}
              </div>
            </div>
            <button className="primary-button" onClick={() => markPlayed(match.id)}>
              Mark played
            </button>
          </div>
        ))}
      </div>

      {played.length > 0 && (
        <>
          <h2>Recently played</h2>
          <div className="match-list">
            {played.map((match) => (
              <div className="match-card match-card-played" key={match.id}>
                {match.thumbnail && <img src={match.thumbnail} alt={match.name} />}
                <div className="match-card-info">
                  <h3>{match.name}</h3>
                  <div className="game-card-tags">
                    <span>Played {new Date(match.playedAt!).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
