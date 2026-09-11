import { useEffect, useRef, useState } from "react";
import { api, type Match } from "../api";
import { IconSparkle } from "../components/icons";

function meta(match: Match): string {
  const bits: string[] = [];
  if (match.minPlayers && match.maxPlayers) {
    bits.push(match.minPlayers === match.maxPlayers ? `${match.minPlayers}p` : `${match.minPlayers}–${match.maxPlayers}p`);
  }
  if (match.playingTime) bits.push(`${match.playingTime} min`);
  if (match.weight !== null) bits.push(`weight ${match.weight.toFixed(1)}`);
  return bits.join(" · ");
}

export default function Matches({ matches, onChanged }: { matches: Match[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pending = matches.filter((m) => !m.playedAt);
  const played = matches.filter((m) => m.playedAt);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Drop the highlight if that match is gone (played, or the round was reset).
  useEffect(() => {
    if (chosenId !== null && !pending.some((m) => m.id === chosenId)) setChosenId(null);
  }, [matches]);

  async function markPlayed(matchId: number) {
    try {
      await api.markPlayed(matchId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that match");
    }
  }

  /** Flickers through the candidates before settling, so the pick reads as a draw. */
  function chooseForMe() {
    if (pending.length === 0 || rolling) return;
    const winner = pending[Math.floor(Math.random() * pending.length)];

    if (pending.length === 1) {
      setChosenId(winner.id);
      return;
    }

    setRolling(true);
    timers.current.forEach(clearTimeout);
    timers.current = [];

    const steps = 12;
    for (let i = 0; i < steps; i++) {
      timers.current.push(
        setTimeout(() => {
          setChosenId(pending[Math.floor(Math.random() * pending.length)].id);
        }, i * 70)
      );
    }
    timers.current.push(
      setTimeout(() => {
        setChosenId(winner.id);
        setRolling(false);
        document.getElementById(`match-${winner.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, steps * 70)
    );
  }

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      <div className="matches-head">
        <div className="section-heading">
          Ready to play{pending.length > 0 ? ` · ${pending.length}` : ""}
        </div>
        {pending.length > 1 && (
          <button className="btn btn-ghost btn-choose" onClick={chooseForMe} disabled={rolling}>
            <IconSparkle />
            {rolling ? "Choosing…" : "Choose for me"}
          </button>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">🤝</div>
          <h3>No matches yet</h3>
          <p>When everyone swipes right on the same game it lands here.</p>
        </div>
      ) : (
        pending.map((match) => (
          <div
            id={`match-${match.id}`}
            className={`match-card ${chosenId === match.id ? "is-chosen" : ""}`}
            key={match.id}
          >
            {match.thumbnail ? <img src={match.thumbnail} alt="" loading="lazy" /> : <img alt="" />}
            <div className="match-info">
              <h3>{match.name}</h3>
              <div className="match-meta">
                {chosenId === match.id && !rolling ? (
                  <span className="pick-note">
                    <IconSparkle /> Tonight's pick
                  </span>
                ) : (
                  meta(match)
                )}
              </div>
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
