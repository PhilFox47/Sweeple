import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import {
  authenticate,
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionToken,
  requireAdmin,
  setSessionCookie,
} from "../auth.js";
import { getActiveRound } from "../rounds.js";
import { broadcast } from "../ws.js";

interface UserRow {
  id: number;
  username: string;
  displayName: string;
  role: "core" | "guest";
}

function listUsers(): (UserRow & { isAdmin: boolean })[] {
  const rows = db
    .prepare("SELECT id, username, display_name as displayName, role FROM users ORDER BY role = 'guest', id")
    .all() as UserRow[];
  return rows.map((u) => ({ ...u, isAdmin: u.role === "core" }));
}

export default async function authRoutes(app: FastifyInstance) {
  // The profile picker. No passwords: this runs on a home network for a couple of people.
  app.get("/api/users", async () => {
    return { users: listUsers() };
  });

  app.post<{ Body: { userId: number } }>("/api/login", async (request, reply) => {
    const userId = Number(request.body?.userId);
    if (!Number.isFinite(userId)) return reply.code(400).send({ error: "Pick a profile." });

    const user = db
      .prepare("SELECT id, display_name as displayName, role FROM users WHERE id = ?")
      .get(userId) as { id: number; displayName: string; role: string } | undefined;
    if (!user) return reply.code(404).send({ error: "That profile no longer exists." });

    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(reply, token, expiresAt);
    return { id: user.id, displayName: user.displayName, role: user.role, isAdmin: user.role === "core" };
  });

  app.post("/api/logout", async (request, reply) => {
    const token = getSessionToken(request);
    if (token) destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: authenticate }, async (request) => {
    return { ...request.user, isAdmin: request.user!.role === "core" };
  });

  // Temporary players for tonight's round. Admins only.
  app.post<{ Body: { displayName: string } }>(
    "/api/users/guest",
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const displayName = request.body?.displayName?.trim();
      if (!displayName) return reply.code(400).send({ error: "Give the player a name." });
      if (displayName.length > 40) return reply.code(400).send({ error: "That name is too long." });

      // Usernames are an internal handle only; derive one that cannot collide.
      const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "guest";
      let username = base;
      for (let n = 2; db.prepare("SELECT 1 FROM users WHERE username = ?").get(username); n++) {
        username = `${base}-${n}`;
      }

      const info = db
        .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, '', ?, 'guest')")
        .run(username, displayName);
      broadcast({ type: "players-changed" });
      return { id: Number(info.lastInsertRowid), displayName, isAdmin: false };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id) as
        | { id: number; role: string }
        | undefined;
      if (!user) return reply.code(404).send({ error: "No such player." });
      if (user.role === "core") return reply.code(400).send({ error: "The permanent profiles cannot be removed." });

      const round = getActiveRound();
      if (round?.players.some((p) => p.id === id)) {
        return reply.code(400).send({ error: "That player is in the running round. Start a new round first." });
      }

      // Swipes and sessions cascade; their past matches stay as shared history.
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      broadcast({ type: "players-changed" });
      return { ok: true };
    }
  );
}
