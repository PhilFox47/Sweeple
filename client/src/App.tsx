import { useCallback, useEffect, useState } from "react";
import { api, type CurrentUser, type Match, type Round } from "./api";
import Toasts, { type Toast } from "./components/Toasts";
import { IconCards, IconHeart, IconSettings } from "./components/icons";
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
  const [matches, setMatches] = useState<Match[]>([]);
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

  // Held here rather than in the Matches page so the tab badge and the list agree.
  const loadMatches = useCallback(async () => {
    try {
      setMatches((await api.matches()).matches);
    } catch {
      // Not signed in yet.
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((me) => {
        setUser(me);
        loadRound();
        loadMatches();
      })
      .catch(() => setUser(null));
  }, [loadRound, loadMatches]);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5500);
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "match") {
        pushToast("match", `It's a match — "${event.gameName}" 🎉`);
        loadMatches();
      } else if (event.type === "round-changed") {
        loadRound();
        setLibraryRefresh((n) => n + 1);
        loadMatches();
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
          pushToast("info", `Synced — ${event.gamesAdded} added, ${event.gamesUpdated} updated.`);
        } else if (event.error === "Sync stopped") {
          pushToast("info", "Sync stopped.");
        } else {
          pushToast("error", `Sync failed: ${event.error}`);
        }
      }
    },
    [pushToast, loadRound, loadMatches]
  );

  useServerEvents(handleServerEvent);

  // Matches waiting to be played — the round's decisions are cleared when a new one starts,
  // so this is also "how many we've found tonight".
  const pendingMatches = matches.filter((m) => !m.playedAt).length;

  async function handleSignOut() {
    await api.logout();
    setUser(null);
    setTab("swipe");
  }

  if (user === undefined) {
    return (
      <div className="profile-screen">
        <div className="empty-state">
          <div className="empty-emoji">🎲</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ProfileSelect
        onSignedIn={(u) => {
          setUser(u);
          loadRound();
          loadMatches();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="brand">
          <span className="brand-mark">🎲</span>
          Sweeple
        </h1>
        <button className="header-user" onClick={handleSignOut} aria-label={`Signed in as ${user.displayName}. Switch profile`}>
          <span className={`avatar ${user.isAdmin ? "" : "avatar-guest"}`}>
            {user.displayName.charAt(0).toUpperCase()}
          </span>
        </button>
      </header>

      <div className={`round-strip ${round ? "" : "round-strip-idle"}`}>
        <i className="round-dot" />
        {round ? (
          <span>
            <strong>{round.playerCount}</strong> playing ·{" "}
            {round.players.map((p) => p.displayName).join(", ")}
          </span>
        ) : (
          <span>{user.isAdmin ? "No round yet — start one in Settings" : "Waiting for Phil or Leo to start a round"}</span>
        )}
      </div>

      <main className="app-main">
        {tab === "swipe" && <Swipe refreshToken={libraryRefresh} round={round} />}
        {tab === "matches" && (
          <div className="scroll-area">
            <Matches matches={matches} onChanged={loadMatches} />
            <div className="bgg-credit">
              <a href="https://boardgamegeek.com" target="_blank" rel="noreferrer">
                Powered by BGG
              </a>
            </div>
          </div>
        )}
        {tab === "settings" && user.isAdmin && (
          <div className="scroll-area">
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
            <div className="bgg-credit">
              <a href="https://boardgamegeek.com" target="_blank" rel="noreferrer">
                Powered by BGG
              </a>
            </div>
          </div>
        )}
      </main>

      <nav className="tab-bar">
        <button className={tab === "swipe" ? "tab-active" : ""} onClick={() => setTab("swipe")}>
          <IconCards />
          Swipe
        </button>
        <button className={tab === "matches" ? "tab-active" : ""} onClick={() => setTab("matches")}>
          <span className="tab-icon">
            <IconHeart />
            {pendingMatches > 0 && (
              <span className="tab-badge" key={pendingMatches}>
                {pendingMatches}
              </span>
            )}
          </span>
          Matches
        </button>
        {user.isAdmin && (
          <button className={tab === "settings" ? "tab-active" : ""} onClick={() => setTab("settings")}>
            <IconSettings />
            Settings
          </button>
        )}
      </nav>

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}
