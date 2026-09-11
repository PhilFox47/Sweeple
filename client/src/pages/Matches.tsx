import { useEffect, useState } from "react";
import { api, type Match } from "../api";

function meta(match: Match): string {
  const bits: string[] = [];
  if (match.minPlayers && match.maxPlayers) {
    bits.push(match.minPlayers === match.maxPlayers ? `${match.minPlayers}p` : `${match.minPlayers}–${match.maxPlayers}p`);
  }
  if (match.playingTime) bits.push(`${match.playingTime} min`);
  if (match.weight !== null) bits.push(`weight ${match.weight.toFixed(1)}`);
  return bits.join(" · ");
}

export default function Matches({ refreshToken }: { refreshToken: number }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setMatches((await api.matches()).matches);
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

  if (loading) return <div className="empty-state">Loading…</div>;

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      <div className="section-heading">Ready to play</div>
      {pending.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">🤝</div>
          <h3>No matches yet</h3>
          <p>When everyone swipes right on the same game it lands here.</p>
        </div>
      ) : (
        pending.map((match) => (
          <div className="match-card" key={match.id}>
            {match.thumbnail ? <img src={match.thumbnail} alt="" loading="lazy" /> : <img alt="" />}
            <div className="match-info">
              <h3>{match.name}</h3>
              <div className="match-meta">{meta(match)}</div>
            </div>
            <button className="btn btn-primary" onClick={() => markPlayed(match.id)}>
              Played
            </button>
          </div>
        ))
      )}

      {played.length > 0 && (
        <>
          <div className="section-heading">History</div>
          {played.map((match) => (
            <div className="match-card match-played" key={match.id}>
              {match.thumbnail ? <img src={match.thumbnail} alt="" loading="lazy" /> : <img alt="" />}
              <div className="match-info">
                <h3>{match.name}</h3>
                <div className="match-meta">Played {new Date(match.playedAt!).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
