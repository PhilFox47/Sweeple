import { useEffect, useState } from "react";
import { api, type CurrentUser, type Player } from "../api";

export default function ProfileSelect({ onSignedIn }: { onSignedIn: (user: CurrentUser) => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listUsers()
      .then((r) => setPlayers(r.users))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load profiles"));
  }, []);

  async function pick(player: Player) {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(player.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  }

  const admins = players.filter((p) => p.isAdmin);
  const guests = players.filter((p) => !p.isAdmin);

  function card(p: Player) {
    return (
      <button key={p.id} className="profile-card" onClick={() => pick(p)} disabled={busy}>
        <span className={`avatar ${p.isAdmin ? "" : "avatar-guest"}`}>
          {p.displayName.charAt(0).toUpperCase()}
        </span>
        {p.displayName}
      </button>
    );
  }

  return (
    <div className="profile-screen">
      <div className="profile-hero">
        <div className="brand-mark">🎲</div>
        <h1>Sweeple</h1>
        <p>Who's playing tonight?</p>
      </div>

      <div className="profile-grid">{admins.map(card)}</div>

      {guests.length > 0 && (
        <>
          <div className="profile-label">Guests</div>
          <div className="profile-grid">{guests.map(card)}</div>
        </>
      )}

      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
