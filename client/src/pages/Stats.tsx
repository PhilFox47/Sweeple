import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CurrentUser, type GameStat, type Player, type Stats as StatsData } from "../api";
import Avatar from "../components/Avatar";

type Sort = "least" | "most" | "votes";

const SORTS: { value: Sort; label: string }[] = [
  { value: "least", label: "Least picked" },
  { value: "most", label: "Most picked" },
  { value: "votes", label: "Most votes" },
];

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

function rateClass(ratio: number): string {
  if (ratio <= 0.34) return "rate-low";
  if (ratio >= 0.66) return "rate-high";
  return "rate-mid";
}

function sortGames(games: GameStat[], sort: Sort): GameStat[] {
  const copy = [...games];
  if (sort === "votes") return copy.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const dir = sort === "least" ? 1 : -1;
  // More votes breaks a tie: 0% of six passes says more than 0% of one.
  return copy.sort((a, b) => dir * (a.ratio - b.ratio) || b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * Everyone can see their own picks. The two permanent profiles can also look at anyone else's,
 * one or several at a time — several summed together is how you find the games you both keep
 * turning down.
 */
export default function Stats({ user, refreshToken }: { user: CurrentUser; refreshToken: number }) {
  const [everyone, setEveryone] = useState<Player[]>([]);
  const [selected, setSelected] = useState<number[]>([user.id]);
  const [data, setData] = useState<StatsData | null>(null);
  const [sort, setSort] = useState<Sort>("least");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user.isAdmin) return;
    api
      .listUsers()
      .then((r) => setEveryone(r.users))
      .catch(() => setEveryone([]));
  }, [user.isAdmin, refreshToken]);

  const load = useCallback(async (ids: number[]) => {
    setLoading(true);
    try {
      setData(await api.stats(ids));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the picks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected.length > 0) load(selected);
    else setData(null);
  }, [selected, load, refreshToken]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  const games = useMemo(() => sortGames(data?.games ?? [], sort), [data, sort]);
  const showBreakdown = selected.length > 1;

  return (
    <div className="scroll-area stats-page">
      {user.isAdmin && (
        <section className="panel">
          <h3>Whose picks?</h3>
          <p className="panel-hint">
            Pick more than one to see them added up — the games the whole group keeps turning down.
          </p>
          <div className="chip-list">
            {everyone.map((p) => (
              <button
                key={p.id}
                className={`chip chip-avatar ${selected.includes(p.id) ? "chip-active" : ""}`}
                onClick={() => toggle(p.id)}
              >
                <Avatar name={p.displayName} src={p.avatar} isAdmin={p.isAdmin} className="avatar-xs" />
                {p.displayName}
                {p.id === user.id && <span className="chip-tag">you</span>}
              </button>
            ))}
          </div>
          {selected.length === 0 && <p className="panel-hint">Nobody selected.</p>}
        </section>
      )}

      {data && data.summary.votes > 0 && (
        <div className="stats-summary">
          <div className="stat-tile">
            <span className="stat-value">{pct(data.summary.ratio ?? 0)}</span>
            <span className="stat-label">picked</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{data.summary.votes}</span>
            <span className="stat-label">{data.summary.votes === 1 ? "vote" : "votes"}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{data.summary.games}</span>
            <span className="stat-label">games seen</span>
          </div>
        </div>
      )}

      <div className="sort-row">
        {SORTS.map((s) => (
          <button
            key={s.value}
            className={`chip ${sort === s.value ? "chip-active" : ""}`}
            onClick={() => setSort(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading && !data && <p className="panel-hint">Counting…</p>}
      {error && <div className="form-error">{error}</div>}

      {data && games.length === 0 && !loading && (
        <div className="empty-state">
          <div className="empty-emoji">🗳️</div>
          <p>No picks recorded yet. Swipe through a round and they will show up here.</p>
        </div>
      )}

      <div className="stat-rows">
        {games.map((game) => (
          <div className="stat-row" key={game.gameId}>
            {game.thumbnail ? (
              <img className="stat-thumb" src={game.thumbnail} alt="" loading="lazy" />
            ) : (
              <div className="stat-thumb stat-thumb-empty" />
            )}
            <div className="stat-meta">
              <span className="stat-name">{game.name}</span>
              <span className="stat-sub">
                <span className={`rate ${rateClass(game.ratio)}`}>{pct(game.ratio)} picked</span>
                <span className="rate-total">
                  {game.likes} of {game.total} {game.total === 1 ? "vote" : "votes"}
                </span>
              </span>
              {showBreakdown && (
                <span className="stat-players">
                  {game.byPlayer.map((p) => (
                    <span className="rate-player" key={p.id}>
                      {p.displayName} {pct(p.likes / p.total)} ({p.total})
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className="stat-bar" aria-hidden="true">
              <i className={rateClass(game.ratio)} style={{ width: `${Math.round(game.ratio * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
