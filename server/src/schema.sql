CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'core' CHECK (role IN ('core', 'guest')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bgg_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  year_published INTEGER,
  thumbnail TEXT,
  image TEXT,
  min_players INTEGER,
  max_players INTEGER,
  min_playtime INTEGER,
  max_playtime INTEGER,
  playing_time INTEGER,
  weight REAL,
  average_rating REAL,
  bgg_rank INTEGER,
  categories TEXT NOT NULL DEFAULT '[]',
  mechanics TEXT NOT NULL DEFAULT '[]',
  num_plays INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  is_expansion INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  short_description TEXT,
  short_checked_at TEXT,
  summary TEXT,
  -- 'ai': machine-translated from summary_from. 'manual': written by hand, never replaced.
  summary_source TEXT CHECK (summary_source IN ('ai', 'manual')),
  summary_from TEXT,
  -- Which Nano-GPT model made the translation, so models can be compared.
  summary_model TEXT,
  owned INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS swipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('like', 'dislike')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, game_id)
);

-- Every decision ever made, kept across rounds. `swipes` is the current sitting and gets wiped;
-- this is the history the pick ratings are built from. One row per player per game per round, so
-- changing your mind mid-round corrects the vote instead of counting twice, while the same game
-- coming round again on another evening counts again.
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL CHECK (decision IN ('like', 'dislike')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, game_id, round_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_game ON votes(game_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_game ON votes(user_id, game_id);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  -- The sitting this match belongs to; the Matches tab only shows the running one. Unique per
  -- round rather than per game: a game agreed on months ago can be agreed on again tonight.
  round_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  played_at TEXT,
  -- 'full' when everyone in the round liked it; 'soft' when enough did once the round dragged on.
  kind TEXT NOT NULL DEFAULT 'full',
  -- How many of the round's players had liked it when the match was last re-evaluated.
  likes INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, round_id)
);

-- How big each player's deck was, under their own filters, the last time they fetched it.
-- Progress through a round is swipes made over this, which is what decides soft matches.
CREATE TABLE IF NOT EXISTS round_progress (
  round_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_total INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (round_id, user_id)
);

-- A swipe round is one sitting: a fixed set of players deciding on a game together.
-- The active round is the one with ended_at IS NULL.
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  player_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  games_added INTEGER NOT NULL DEFAULT 0,
  games_updated INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

-- Settings changed from the web UI rather than .env, such as the translation model.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
