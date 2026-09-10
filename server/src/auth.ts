import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { db } from "./db.js";

const SESSION_COOKIE = "sweeple_session";
const SESSION_TTL_DAYS = 30;

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: "core" | "guest";
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function getUserForToken(token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name as displayName, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as SessionUser | undefined;
  return row ?? null;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  const user = token ? getUserForToken(token) : null;
  if (!user) {
    reply.code(401).send({ error: "Not authenticated" });
    return;
  }
  request.user = user;
}

export function getSessionToken(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}
