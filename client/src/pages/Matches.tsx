import { useEffect, useRef, useState } from "react";
import { api, type Match, type MatchThreshold } from "../api";
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

/** One line on what a match takes right now, shown only once there are enough players for it to vary. */
function thresholdNote(threshold: MatchThreshold | null): string | null {
  if (!threshold || threshold.players < 3) return null;
  if (threshold.required < threshold.players) {
    return `Soft matches count now: ${threshold.required} of ${threshold.players} likes is enough.`;
  }
  return `Everyone has to agree for now. Once a third player is three quarters through their deck, ${
    threshold.players - 1
  } of ${threshold.players} will do.`;
}

export default function Matches({
  matches,
  threshold,
  onChanged,
}: {
  matches: Match[];
  threshold: MatchThreshold | null;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pending = matches.filter((m) => !m.playedAt);
  const full = pending.filter((m) => m.kind === "full");
  const soft = pending.filter((m) => m.kind === "soft");
  const played = matches.filter((m) => m.playedAt);
  const note = thresholdNote(threshold);

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
    // A game everybody wanted beats one most people did, so soft matches are only drawn from
    // when there is no full one.
    const pool = full.length > 0 ? full : soft;
    if (pool.length === 0 || rolling) return;
    const winner = pool[Math.floor(Math.random() * pool.length)];

    if (pool.length === 1) {
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
          setChosenId(pool[Math.floor(Math.random() * pool.length)].id);
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

  function card(match: Match) {
    return (
      <div
        id={`match-${match.id}`}
        className={`match-card ${match.kind === "soft" ? "is-soft" : ""} ${chosenId === match.id ? "is-chosen" : ""}`}
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
              <>
                {match.kind === "soft" && threshold && (
                  <span className="soft-tag">
                    {match.likes} of {threshold.players}
                  </span>
                )}
                {meta(match)}
              </>
            )}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => markPlayed(match.id)}>
          Played
        </button>
      </div>
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

      {note && <p className="threshold-note">{note}</p>}

      {pending.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">🤝</div>
          <h3>No matches yet</h3>
          <p>When everyone swipes right on the same game it lands here.</p>
        </div>
      ) : (
        <>
          {full.map((match) => card(match))}
          {soft.length > 0 && (
            <>
              <div className="section-heading soft-heading">Soft matches · {soft.length}</div>
              <p className="threshold-note">Most of you liked these, not everyone.</p>
              {soft.map((match) => card(match))}
            </>
          )}
        </>
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
