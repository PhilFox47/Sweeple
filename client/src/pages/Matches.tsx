import { useEffect, useRef, useState } from "react";
import { api, type Match, type MatchThreshold } from "../api";
import { IconSparkle } from "../components/icons";
import { decimal } from "../utils/format";

function meta(match: Match): string {
  const bits: string[] = [];
  if (match.minPlayers && match.maxPlayers) {
    bits.push(match.minPlayers === match.maxPlayers ? `${match.minPlayers} Sp.` : `${match.minPlayers}–${match.maxPlayers} Sp.`);
  }
  if (match.playingTime) bits.push(`${match.playingTime} min`);
  if (match.weight !== null) bits.push(`Komplexität ${decimal(match.weight)}`);
  return bits.join(" · ");
}

/** One line on what a match takes right now, shown only once there are enough players for it to vary. */
function thresholdNote(threshold: MatchThreshold | null): string | null {
  if (!threshold || threshold.players < 3) return null;
  if (threshold.required < threshold.players) {
    return `Mehrheits-Matches zählen jetzt: ${threshold.required} von ${threshold.players} Stimmen reichen.`;
  }
  return `Noch müssen alle zustimmen. Sobald ein dritter Spieler drei Viertel seines Stapels durch hat, reichen ${
    threshold.players - 1
  } von ${threshold.players}.`;
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
      setError(err instanceof Error ? err.message : "Das Match konnte nicht aktualisiert werden");
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
                <IconSparkle /> Heute gespielt wird
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
          Gespielt
        </button>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      <div className="matches-head">
        <div className="section-heading">
          Bereit zum Spielen{pending.length > 0 ? ` · ${pending.length}` : ""}
        </div>
        {pending.length > 1 && (
          <button className="btn btn-ghost btn-choose" onClick={chooseForMe} disabled={rolling}>
            <IconSparkle />
            {rolling ? "Wähle…" : "Wähl für mich"}
          </button>
        )}
      </div>

      {note && <p className="threshold-note">{note}</p>}

      {pending.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">🤝</div>
          <h3>Noch keine Matches</h3>
          <p>Sobald alle beim selben Spiel nach rechts swipen, landet es hier.</p>
        </div>
      ) : (
        <>
          {full.map((match) => card(match))}
          {soft.length > 0 && (
            <>
              <div className="section-heading soft-heading">Mehrheits-Matches · {soft.length}</div>
              <p className="threshold-note">Die meisten wollen diese, aber nicht alle.</p>
              {soft.map((match) => card(match))}
            </>
          )}
        </>
      )}

      {played.length > 0 && (
        <>
          <div className="section-heading">Schon gespielt</div>
          {played.map((match) => (
            <div className="match-card match-played" key={match.id}>
              {match.thumbnail ? <img src={match.thumbnail} alt="" loading="lazy" /> : <img alt="" />}
              <div className="match-info">
                <h3>{match.name}</h3>
                <div className="match-meta">Gespielt am {new Date(match.playedAt!).toLocaleDateString("de-DE")}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
