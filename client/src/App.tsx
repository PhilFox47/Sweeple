import { useCallback, useEffect, useState } from "react";
import { api, type CurrentUser, type Round } from "./api";
import Toasts, { type Toast } from "./components/Toasts";
import { useServerEvents, type ServerEvent } from "./hooks/useServerEvents";
import Matches from "./pages/Matches";
import ProfileSelect from "./pages/ProfileSelect";
import Settings from "./pages/Settings";
import Swipe from "./pages/Swipe";

type Tab = "swipe" | "matches" | "settings";

let toastId = 0;

export default function App() {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  const [round, setRound] = useState<Round | null>(null);
  const [tab, setTab] = useState<Tab>("swipe");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [matchesRefresh, setMatchesRefresh] = useState(0);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [syncSignal, setSyncSignal] = useState(0);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  const loadRound = useCallback(async () => {
    try {
      setRound((await api.round()).round);
    } catch {
      // Not signed in yet; the round loads again after sign-in.
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((me) => {
        setUser(me);
        loadRound();
      })
      .catch(() => setUser(null));
  }, [loadRound]);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "match") {
        pushToast("match", `It's a match! You all liked "${event.gameName}" 🎉`);
        setMatchesRefresh((n) => n + 1);
      } else if (event.type === "round-changed") {
        loadRound();
        setLibraryRefresh((n) => n + 1);
        setMatchesRefresh((n) => n + 1);
        pushToast("info", "The swipe round was updated.");
      } else if (event.type === "players-changed") {
        setLibraryRefresh((n) => n + 1);
      } else if (event.type === "sync-started") {
        setSyncProgress(null);
        setSyncSignal((n) => n + 1);
      } else if (event.type === "sync-progress") {
        setSyncProgress(event.message);
      } else if (event.type === "library-changed") {
        setLibraryRefresh((n) => n + 1);
      } else if (event.type === "sync-finished") {
        setSyncProgress(null);
        setSyncSignal((n) => n + 1);
        setLibraryRefresh((n) => n + 1);
        if (event.status === "success") {
          pushToast("info", `BGG sync complete: ${event.gamesAdded} added, ${event.gamesUpdated} updated.`);
        } else if (event.error === "Sync stopped") {
          pushToast("info", "Sync stopped.");
        } else {
          pushToast("error", `BGG sync failed: ${event.error}`);
        }
      }
    },
    [pushToast, loadRound]
  );

  useServerEvents(handleServerEvent);

  async function handleSignOut() {
    await api.logout();
    setUser(null);
    setTab("swipe");
  }

  if (user === undefined) return <div className="empty-state">Loading…</div>;
  if (!user) {
    return (
      <ProfileSelect
        onSignedIn={(u) => {
          setUser(u);
          loadRound();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>🎲 Sweeple</h1>
        <div className="app-header-right">
          <span className="current-user">{user.displayName}</span>
          <button className="link-button" onClick={handleSignOut}>
            Switch
          </button>
        </div>
      </header>

      {round ? (
        <div className="round-banner">
          Round with {round.players.map((p) => p.displayName).join(", ")} · showing games for{" "}
          <strong>{round.playerCount}</strong>
        </div>
      ) : (
        <div className="round-banner round-banner-idle">
          No round running{user.isAdmin ? " — start one in Settings." : " — ask Phil or Leo to start one."}
        </div>
      )}

      <nav className="tab-bar">
        <button className={tab === "swipe" ? "tab-active" : ""} onClick={() => setTab("swipe")}>
          Swipe
        </button>
        <button className={tab === "matches" ? "tab-active" : ""} onClick={() => setTab("matches")}>
          Matches
        </button>
        {user.isAdmin && (
          <button className={tab === "settings" ? "tab-active" : ""} onClick={() => setTab("settings")}>
            Settings
          </button>
        )}
      </nav>

      <main className="app-main">
        {tab === "swipe" && <Swipe refreshToken={libraryRefresh} round={round} />}
        {tab === "matches" && <Matches refreshToken={matchesRefresh} />}
        {tab === "settings" && user.isAdmin && (
          <Settings
            round={round}
            refreshToken={libraryRefresh}
            syncSignal={syncSignal}
            syncProgress={syncProgress}
            onChanged={() => {
              loadRound();
              setLibraryRefresh((n) => n + 1);
            }}
          />
        )}
      </main>

      <footer className="app-footer">
        <a href="https://boardgamegeek.com" target="_blank" rel="noreferrer">
          Powered by BGG
        </a>
      </footer>

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}
