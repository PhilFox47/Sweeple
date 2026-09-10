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

function seedUser(username: string | undefined, password: string | undefined, displayName: string) {
  if (!username || !password) return;
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return;
  db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'core')"
  ).run(username, hashPassword(password), displayName);
}

seedUser(process.env.USER1_USERNAME, process.env.USER1_PASSWORD, process.env.USER1_DISPLAY_NAME ?? "Player 1");
seedUser(process.env.USER2_USERNAME, process.env.USER2_PASSWORD, process.env.USER2_DISPLAY_NAME ?? "Player 2");
