import type { FastifyInstance } from "fastify";
import { db, hashPassword, verifyPassword } from "../db.js";
import {
  authenticate,
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionToken,
  setSessionCookie,
} from "../auth.js";

export default async function authRoutes(app: FastifyInstance) {
  app.get("/api/users", async () => {
    const users = db.prepare("SELECT id, username, display_name as displayName FROM users ORDER BY id").all();
    return { users };
  });

  app.post<{ Body: { username: string; password: string } }>("/api/login", async (request, reply) => {
    const { username, password } = request.body ?? ({} as any);
    if (!username || !password) {
      return reply.code(400).send({ error: "Username and password are required" });
    }
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | { id: number; password_hash: string; display_name: string; role: string }
      | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(reply, token, expiresAt);
    return { id: user.id, displayName: user.display_name, role: user.role };
  });

  app.post("/api/logout", async (request, reply) => {
    const token = getSessionToken(request);
    if (token) destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: authenticate }, async (request) => {
    return request.user;
  });

  // Lets either existing (core) user add a guest login later without code changes.
  app.post<{ Body: { username: string; password: string; displayName: string } }>(
    "/api/users/guest",
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.user?.role !== "core") {
        return reply.code(403).send({ error: "Only core users can add guest accounts" });
      }
      const { username, password, displayName } = request.body ?? ({} as any);
      if (!username || !password || !displayName) {
        return reply.code(400).send({ error: "username, password and displayName are required" });
      }
      try {
        db.prepare(
          "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'guest')"
        ).run(username, hashPassword(password), displayName);
      } catch {
        return reply.code(409).send({ error: "Username already exists" });
      }
      return { ok: true };
    }
  );
}
