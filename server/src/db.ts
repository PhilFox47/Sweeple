import Database from "better-sqlite3";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR ?? "/data";
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(`${DATA_DIR}/sweeple.db`);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = readFileSync(`${__dirname}/schema.sql`, "utf-8");
db.exec(schema);

/**
 * CREATE TABLE IF NOT EXISTS never alters an existing table, so columns added after a database
 * was first created have to be filled in here. Existing rows keep their data.
 */
function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] migrated: added ${table}.${column}`);
}

addColumnIfMissing("games", "best_players", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("games", "recommended_players", "TEXT NOT NULL DEFAULT '[]'");
// Manual override of whether a game counts as an expansion. "auto" defers to BGG's own flag.
// Deliberately never written by syncing or importing, so choices survive a library refresh.
addColumnIfMissing("games", "expansion_mode", "TEXT NOT NULL DEFAULT 'auto'");

// Profile pictures live in the database rather than on disk: they are a few tens of kilobytes
// each for a handful of profiles, and this way a backup of the database is the whole app.
addColumnIfMissing("users", "avatar", "BLOB");
addColumnIfMissing("users", "avatar_type", "TEXT");
// Part of the avatar URL, so a new picture is fetched immediately while old ones cache forever.
addColumnIfMissing("users", "avatar_version", "INTEGER NOT NULL DEFAULT 0");

/**
 * Votes were introduced after the app had been in use, and the swipes sitting in the database at
 * that point are real decisions. Carry them over once so the first ratings are not empty.
 */
const voteCount = (db.prepare("SELECT COUNT(*) AS n FROM votes").get() as { n: number }).n;
if (voteCount === 0) {
  const round = db.prepare("SELECT id FROM rounds WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;
  const copied = db
    .prepare(
      `INSERT OR IGNORE INTO votes (user_id, game_id, round_id, decision, created_at)
       SELECT user_id, game_id, ?, decision, created_at FROM swipes`
    )
    .run(round?.id ?? 0).changes;
  if (copied > 0) console.log(`[db] migrated: seeded ${copied} pick ratings from the current round`);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The two permanent profiles. Role "core" means admin here — they are the only ones who can
 * manage rounds, players and syncing. Temporary players are added at role "guest".
 * Sign-in is by profile pick with no password, so the hash column is left empty.
 */
const ADMINS: { username: string; displayName: string }[] = [
  { username: "phil", displayName: "Phil" },
  { username: "leo", displayName: "Leo" },
];

function seedAdmin(username: string, displayName: string) {
  const existing = db.prepare("SELECT id, display_name FROM users WHERE username = ?").get(username) as
    | { id: number; display_name: string }
    | undefined;
  if (existing) {
    // The names are fixed, so correct any left over from the old env-var seeding.
    if (existing.display_name !== displayName) {
      console.log(`[db] renamed profile "${existing.display_name}" to "${displayName}"`);
    }
    db.prepare("UPDATE users SET role = 'core', display_name = ? WHERE id = ?").run(displayName, existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, '', ?, 'core')"
  ).run(username, displayName);
}

for (const admin of ADMINS) seedAdmin(admin.username, admin.displayName);

/**
 * Earlier versions seeded the permanent profiles from USER1_/USER2_ environment variables, so a
 * database can still hold an admin under some other username. Those are duplicates of Phil and
 * Leo and would show up as extra profiles in the picker, so drop them. Their swipes go too, but
 * swipes are per-round and cleared whenever a round starts; match history is not tied to a user.
 */
const strays = db
  .prepare(
    `SELECT id, display_name FROM users
     WHERE role = 'core' AND username NOT IN (${ADMINS.map(() => "?").join(",")})`
  )
  .all(...ADMINS.map((a) => a.username)) as { id: number; display_name: string }[];

for (const stray of strays) {
  db.prepare("DELETE FROM users WHERE id = ?").run(stray.id);
  console.log(`[db] removed leftover profile "${stray.display_name}" (superseded by Phil and Leo)`);
}
