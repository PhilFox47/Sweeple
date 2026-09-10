import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { authenticate } from "../auth.js";
import { isSyncInProgress, runSync } from "../sync.js";

export default async function syncRoutes(app: FastifyInstance) {
  app.post("/api/sync", { preHandler: authenticate }, async (request, reply) => {
    if (isSyncInProgress()) {
      return reply.code(409).send({ error: "Sync already in progress" });
    }
    runSync().catch((err) => app.log.error(err, "BGG sync failed"));
    return { ok: true, started: true };
  });

  app.get("/api/sync/status", { preHandler: authenticate }, async () => {
    const last = db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").get();
    return { inProgress: isSyncInProgress(), last };
  });
}
