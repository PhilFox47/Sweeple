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

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  played_at TEXT
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
