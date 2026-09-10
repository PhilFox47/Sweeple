import { useEffect, useState } from "react";
import { api, type CurrentUser } from "../api";

export default function Login({ onLoggedIn }: { onLoggedIn: (user: CurrentUser) => void }) {
  const [users, setUsers] = useState<{ id: number; username: string; displayName: string }[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listUsers().then((r) => setUsers(r.users));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await api.login(username, password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>🎲 Sweeple</h1>
        <p className="login-subtitle">Swipe your board game collection until you both agree.</p>
        <form onSubmit={handleSubmit}>
          <label>
            Who's playing?
            <select value={username} onChange={(e) => setUsername(e.target.value)} required>
              <option value="" disabled>
                Select a player
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
