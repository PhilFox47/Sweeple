import { useEffect, useState } from "react";
import { api, type Player, type Round } from "../api";
import Import from "./Import";
import ManageExpansions from "../components/ManageExpansions";
import SyncControl from "../components/SyncControl";

export default function Settings({
  round,
  refreshToken,
  syncSignal,
  syncProgress,
  onChanged,
}: {
  round: Round | null;
  refreshToken: number;
  syncSignal: number;
  syncProgress: string | null;
  onChanged: () => void;
}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadPlayers() {
    try {
      const { users } = await api.listUsers();
      setPlayers(users);
      // Default the next round to whoever is already playing, else both admins.
      setSelected((prev) =>
        prev.length > 0
          ? prev.filter((id) => users.some((u) => u.id === id))
          : round
            ? round.players.map((p) => p.id)
            : users.filter((u) => u.isAdmin).map((u) => u.id)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load players");
    }
  }

  useEffect(() => {
    loadPlayers();
  }, [refreshToken]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      onChanged();
      await loadPlayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <section className="panel">
        <h3>Swipe round</h3>
        {round ? (
          <p className="panel-hint">
            Running with <strong>{round.playerCount}</strong>{" "}
            {round.playerCount === 1 ? "player" : "players"}: {round.players.map((p) => p.displayName).join(", ")}.
            The deck is filtered to games that play with {round.playerCount}.
          </p>
        ) : (
          <p className="panel-hint">No round running. Pick who is playing and start one.</p>
        )}

        <p className="field-label">Who is playing?</p>
        <div className="chip-list">
          {players.map((p) => (
            <button
              key={p.id}
              className={`chip ${selected.includes(p.id) ? "chip-active" : ""}`}
              onClick={() => toggle(p.id)}
            >
              {p.displayName}
              {!p.isAdmin && <span className="chip-tag">guest</span>}
            </button>
          ))}
        </div>

        <div className="row-actions">
          <button
            className="btn btn-primary"
            disabled={busy || selected.length === 0}
            onClick={() =>
              run(async () => {
                const { round: started } = await api.startRound(selected);
                return `New round started with ${started.playerCount} ${
                  started.playerCount === 1 ? "player" : "players"
                }. Previous swipes cleared.`;
              })
            }
          >
            Start new round
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !round}
            onClick={() =>
              run(async () => {
                const r = await api.resetRound();
                return `Round reset — ${r.swipes} swipes and ${r.matches} pending matches cleared.`;
              })
            }
          >
            Reset current round
          </button>
        </div>
        <p className="panel-hint">
          Starting or resetting clears everyone's swipes so you begin fresh. Games you already
          marked as played stay in the history.
        </p>
      </section>

      <section className="panel">
        <h3>Temporary players</h3>
        <p className="panel-hint">Add someone joining for tonight. They can swipe but not change settings.</p>
        <div className="inline-form">
          <input
            type="text"
            placeholder="Name"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && guestName.trim()) {
                run(async () => {
                  const p = await api.addGuest(guestName.trim());
                  setGuestName("");
                  return `Added ${p.displayName}.`;
                });
              }
            }}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !guestName.trim()}
            onClick={() =>
              run(async () => {
                const p = await api.addGuest(guestName.trim());
                setGuestName("");
                return `Added ${p.displayName}.`;
              })
            }
          >
            Add
          </button>
        </div>
        <div className="list-rows">
          {players.map((p) => (
            <div className="list-row" key={p.id}>
              <span>
                {p.displayName} {p.isAdmin && <span className="chip-tag">permanent</span>}
              </span>
              {!p.isAdmin && (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => run(async () => {
                    await api.removePlayer(p.id);
                    return `Removed ${p.displayName}.`;
                  })}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <ManageExpansions refreshToken={refreshToken} />

      <section className="panel">
        <h3>BoardGameGeek</h3>
        <SyncControl syncSignal={syncSignal} progress={syncProgress} />
      </section>

      {notice && <div className="form-ok">{notice}</div>}
      {error && <div className="form-error">{error}</div>}

      <Import refreshToken={refreshToken} onImported={onChanged} />
    </div>
  );
}
