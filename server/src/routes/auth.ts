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
import { avatarUrl, decodeDataUrl, readAvatar } from "../avatars.js";
import { getActiveRound } from "../rounds.js";
import { broadcast } from "../ws.js";

interface UserRow {
  id: number;
  username: string;
  displayName: string;
  role: "core" | "guest";
  avatar_version: number;
}

function listUsers() {
  const rows = db
    .prepare(
      `SELECT id, username, display_name as displayName, role, avatar_version
       FROM users ORDER BY role = 'guest', id`
    )
    .all() as UserRow[];
  return rows.map(({ avatar_version, ...u }) => ({
    ...u,
    isAdmin: u.role === "core",
    avatar: avatarUrl(u.id, avatar_version),
  }));
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
      .prepare("SELECT id, username, display_name as displayName, role, avatar_version FROM users WHERE id = ?")
      .get(userId) as
      | { id: number; username: string; displayName: string; role: string; avatar_version: number }
      | undefined;
    if (!user) return reply.code(404).send({ error: "That profile no longer exists." });

    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(reply, token, expiresAt);
    // The same shape as /api/me, so the shell has everything it needs without a second call.
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isAdmin: user.role === "core",
      avatar: avatarUrl(user.id, user.avatar_version),
    };
  });

  app.post("/api/logout", async (request, reply) => {
    const token = getSessionToken(request);
    if (token) destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: authenticate }, async (request) => {
    const version = (db.prepare("SELECT avatar_version FROM users WHERE id = ?").get(request.user!.id) as
      | { avatar_version: number }
      | undefined)?.avatar_version;
    return {
      ...request.user,
      isAdmin: request.user!.role === "core",
      avatar: avatarUrl(request.user!.id, version ?? 0),
    };
  });

  /**
   * Profile pictures. Public to read, because the profile picker is the sign-in screen. Setting
   * one is your own business, or an admin's — the client sends an already-shrunk square.
   */
  app.get<{ Params: { id: string } }>("/api/users/:id/avatar", async (request, reply) => {
    const image = readAvatar(Number(request.params.id));
    if (!image) return reply.code(404).send({ error: "No picture." });
    // The URL carries a version, so this exact URL can be cached hard.
    return reply.type(image.type).header("Cache-Control", "public, max-age=31536000, immutable").send(image.bytes);
  });

  app.put<{ Params: { id: string }; Body: { dataUrl: string } }>(
    "/api/users/:id/avatar",
    { preHandler: authenticate },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (id !== request.user!.id && request.user!.role !== "core") {
        return reply.code(403).send({ error: "You can only change your own picture." });
      }
      const decoded = decodeDataUrl(request.body?.dataUrl);
      if ("error" in decoded) return reply.code(400).send({ error: decoded.error });

      const changed = db
        .prepare("UPDATE users SET avatar = ?, avatar_type = ?, avatar_version = avatar_version + 1 WHERE id = ?")
        .run(decoded.bytes, decoded.type, id).changes;
      if (changed === 0) return reply.code(404).send({ error: "No such profile." });

      const version = (db.prepare("SELECT avatar_version FROM users WHERE id = ?").get(id) as { avatar_version: number })
        .avatar_version;
      broadcast({ type: "players-changed" });
      return { ok: true, avatar: avatarUrl(id, version) };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/users/:id/avatar",
    { preHandler: authenticate },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (id !== request.user!.id && request.user!.role !== "core") {
        return reply.code(403).send({ error: "You can only change your own picture." });
      }
      db.prepare("UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_version = 0 WHERE id = ?").run(id);
      broadcast({ type: "players-changed" });
      return { ok: true };
    }
  );

  /**
   * An extra profile. These are permanent — they keep their own pick ratings across evenings —
   * and are picked into a round like Phil and Leo. Admins only.
   */
  app.post<{ Body: { displayName: string } }>(
    "/api/users",
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const displayName = request.body?.displayName?.trim();
      if (!displayName) return reply.code(400).send({ error: "Give the profile a name." });
      if (displayName.length > 40) return reply.code(400).send({ error: "That name is too long." });

      // Usernames are an internal handle only; derive one that cannot collide.
      const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
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
      if (!user) return reply.code(404).send({ error: "No such profile." });
      if (user.role === "core") return reply.code(400).send({ error: "The permanent profiles cannot be removed." });

      const round = getActiveRound();
      if (round?.players.some((p) => p.id === id)) {
        return reply.code(400).send({ error: "That profile is in the running round. Start a new round first." });
      }

      // Swipes, votes and sessions cascade; past matches stay as shared history.
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      broadcast({ type: "players-changed" });
      return { ok: true };
    }
  );
}
