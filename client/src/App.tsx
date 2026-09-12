import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CurrentUser, type Match, type Round } from "./api";
import Toasts, { type Toast } from "./components/Toasts";
import Avatar from "./components/Avatar";
import { IconCards, IconChart, IconHeart, IconSettings } from "./components/icons";
import { useServerEvents, type ServerEvent } from "./hooks/useServerEvents";
import Matches from "./pages/Matches";
import ProfileSelect from "./pages/ProfileSelect";
import Settings from "./pages/Settings";
import Stats from "./pages/Stats";
import Swipe from "./pages/Swipe";

type Tab = "swipe" | "matches" | "stats" | "settings";

let toastId = 0;

export default function App() {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  // undefined until the first load resolves, so Swipe can wait rather than fetch unfiltered.
  const [round, setRound] = useState<Round | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("swipe");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [syncSignal, setSyncSignal] = useState(0);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  // Every match we have already told this user about, so polling can tell a new one apart from
  // one that was on screen a moment ago. Null until the first load, which never announces.
  const announced = useRef<Set<number> | null>(null);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5500);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const me = await api.me();
      // Replace only on a real change, so the shell does not re-render on every refresh.
      setUser((prev) =>
        prev && prev.id === me.id && prev.displayName === me.displayName && prev.avatar === me.avatar ? prev : me
      );
    } catch {
      // Signed out; the picker takes over.
    }
  }, []);

  // The sitting we last saw, so a round starting elsewhere is noticed. Null before the first load.
  const seenRoundId = useRef<number | null>(null);

  const loadRound = useCallback(async () => {
    try {
      const { round: next } = await api.round();
      // Keep the old object when nothing actually changed: polling would otherwise hand Swipe a
      // new round on every tick and rebuild the deck under the player's thumb.
      setRound((prev) => (sameRound(prev, next) ? prev : next));

      const nextId = next?.id ?? 0;
      if (seenRoundId.current !== null && seenRoundId.current !== nextId) {
        // A new sitting: the previous one's matches are not ours any more. Drop them here rather
        // than leaving a stale list on screen until the refetch lands.
        setMatches([]);
        announced.current = null;
      }
      seenRoundId.current = nextId;
    } catch {
      // Not signed in yet; the round loads again after sign-in.
    }
  }, []);


  // Held here rather than in the Matches page so the tab badge and the list agree.
  const loadMatches = useCallback(async () => {
    try {
      const { matches: next } = await api.matches();
      setMatches(next);

      const pending = next.filter((m) => !m.playedAt);
      const seen = announced.current;
      if (seen) {
        for (const m of pending) {
          if (!seen.has(m.id)) pushToast("match", `It's a match — "${m.name}" 🎉`);
        }
      }
      announced.current = new Set(pending.map((m) => m.id));
    } catch {
      // Not signed in yet.
    }
  }, [pushToast]);

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

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "match") {
        loadMatches();
      } else if (event.type === "round-changed") {
        loadRound();
        setLibraryRefresh((n) => n + 1);
        loadMatches();
      } else if (event.type === "players-changed") {
        setLibraryRefresh((n) => n + 1);
        // A renamed profile or a new picture changes what the header shows.
        loadMe();
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
    [pushToast, loadRound, loadMatches, loadMe]
  );

  // Refetch whenever the live connection comes back, so a match made while the phone was
  // locked or the socket was dropped still shows up without a manual reload.
  const resync = useCallback(() => {
    loadRound();
    loadMatches();
    loadMe();
  }, [loadRound, loadMatches, loadMe]);

  const live = useServerEvents(handleServerEvent, resync);

  /**
   * The socket is an optimisation, not the mechanism. It never connects at all behind a proxy
   * that does not forward the upgrade, and there is no visibility change to lean on while both
   * phones sit in the app swiping, so poll for matches regardless — briskly when the socket is
   * down, slowly as a safety net when it is up.
   */
  useEffect(() => {
    if (!user) return;
    const every = live ? 8_000 : 4_000;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadMatches();
      loadRound();
    }, every);
    return () => clearInterval(timer);
  }, [user, live, loadMatches, loadRound]);

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
          <Avatar name={user.displayName} src={user.avatar} isAdmin={user.isAdmin} />
        </button>
      </header>

      <div className={`round-strip ${round ? "" : "round-strip-idle"}`}>
        <i className="round-dot" />
        {round === undefined ? (
          <span>Loading round…</span>
        ) : round ? (
          <span>
            <strong>{round.playerCount}</strong> playing ·{" "}
            {round.players.map((p) => p.displayName).join(", ")}
          </span>
        ) : (
          <span>{user.isAdmin ? "No round yet — start one in Settings" : "Waiting for Phil or Leo to start a round"}</span>
        )}
        {!live && <span className="live-tag" title="No live connection — checking for matches every few seconds">checking</span>}
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
        {tab === "stats" && <Stats user={user} refreshToken={libraryRefresh} />}
        {tab === "settings" && user.isAdmin && (
          <div className="scroll-area">
            <Settings
              round={round ?? null}
              refreshToken={libraryRefresh}
              syncSignal={syncSignal}
              syncProgress={syncProgress}
              onChanged={() => {
                loadRound();
                loadMatches();
                loadMe();
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
        <button className={tab === "stats" ? "tab-active" : ""} onClick={() => setTab("stats")}>
          <IconChart />
          Picks
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

/** Two rounds are the same sitting if they are the same round with the same players. */
function sameRound(a: Round | null | undefined, b: Round | null): boolean {
  if (a === undefined) return false;
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.playerCount === b.playerCount &&
    a.players.length === b.players.length &&
    a.players.every((p, i) => p.id === b.players[i].id)
  );
}
