import { useCallback, useEffect, useState } from "react";
import { api, type CurrentUser } from "./api";
import SyncControl from "./components/SyncControl";
import Toasts, { type Toast } from "./components/Toasts";
import { useServerEvents, type ServerEvent } from "./hooks/useServerEvents";
import Login from "./pages/Login";
import Matches from "./pages/Matches";
import Swipe from "./pages/Swipe";

type Tab = "swipe" | "matches";

let toastId = 0;

export default function App() {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("swipe");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [matchesRefresh, setMatchesRefresh] = useState(0);
  const [syncSignal, setSyncSignal] = useState(0);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "match") {
        pushToast("match", `It's a match! You both liked "${event.gameName}" 🎉`);
        setMatchesRefresh((n) => n + 1);
      } else if (event.type === "sync-finished") {
        setSyncSignal((n) => n + 1);
        if (event.status === "success") {
          pushToast("info", `BGG sync complete: ${event.gamesAdded} added, ${event.gamesUpdated} updated.`);
        } else {
          pushToast("error", `BGG sync failed: ${event.error}`);
        }
      }
    },
    [pushToast]
  );

  useServerEvents(handleServerEvent);

  async function handleLogout() {
    await api.logout();
    setUser(null);
  }

  if (user === undefined) return <div className="empty-state">Loading…</div>;
  if (!user) return <Login onLoggedIn={setUser} />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>🎲 Sweeple</h1>
        <div className="app-header-right">
          <span className="current-user">Hi, {user.displayName}</span>
          <button className="link-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <SyncControl syncSignal={syncSignal} />

      <nav className="tab-bar">
        <button className={tab === "swipe" ? "tab-active" : ""} onClick={() => setTab("swipe")}>
          Swipe
        </button>
        <button className={tab === "matches" ? "tab-active" : ""} onClick={() => setTab("matches")}>
          Matches
        </button>
      </nav>

      <main className="app-main">
        {tab === "swipe" && <Swipe />}
        {tab === "matches" && <Matches refreshToken={matchesRefresh} />}
      </main>

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}
