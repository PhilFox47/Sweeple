import { useEffect, useState } from "react";
import { api, type CurrentUser, type Player } from "../api";

export default function ProfileSelect({ onSignedIn }: { onSignedIn: (user: CurrentUser) => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    api
      .listUsers()
      .then((r) => setPlayers(r.users))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load profiles"));
  }, []);

  async function pick(player: Player) {
    setBusyId(player.id);
    setError(null);
    try {
      onSignedIn(await api.login(player.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusyId(null);
    }
  }

  const admins = players.filter((p) => p.isAdmin);
  const guests = players.filter((p) => !p.isAdmin);

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>🎲 Sweeple</h1>
        <p className="login-subtitle">Who's swiping?</p>

        <div className="profile-grid">
          {admins.map((p) => (
            <button key={p.id} className="profile-button" onClick={() => pick(p)} disabled={busyId !== null}>
              <span className="profile-initial">{p.displayName.charAt(0).toUpperCase()}</span>
              <span className="profile-name">{p.displayName}</span>
            </button>
          ))}
        </div>

        {guests.length > 0 && (
          <>
            <p className="profile-section-label">Tonight's guests</p>
            <div className="profile-grid">
              {guests.map((p) => (
                <button
                  key={p.id}
                  className="profile-button profile-guest"
                  onClick={() => pick(p)}
                  disabled={busyId !== null}
                >
                  <span className="profile-initial">{p.displayName.charAt(0).toUpperCase()}</span>
                  <span className="profile-name">{p.displayName}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {players.length === 0 && !error && <div className="empty-state">Loading profiles…</div>}
        {error && <div className="form-error">{error}</div>}
      </div>
    </div>
  );
}
