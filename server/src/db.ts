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
function seedAdmin(username: string, displayName: string) {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare("UPDATE users SET role = 'core' WHERE id = ?").run(existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, '', ?, 'core')"
  ).run(username, displayName);
}

seedAdmin("phil", process.env.USER1_DISPLAY_NAME ?? "Phil");
seedAdmin("leo", process.env.USER2_DISPLAY_NAME ?? "Leo");
