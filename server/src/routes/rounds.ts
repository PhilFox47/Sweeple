import type { FastifyInstance } from "fastify";
import { authenticate, requireAdmin } from "../auth.js";
import { clearRoundProgress, getActiveRound, startRound } from "../rounds.js";
import { broadcast } from "../ws.js";

export default async function roundRoutes(app: FastifyInstance) {
  app.get("/api/round", { preHandler: authenticate }, async () => {
    return { round: getActiveRound() };
  });

  app.post<{ Body: { playerIds: number[] } }>(
    "/api/round/start",
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const playerIds = request.body?.playerIds;
      if (!Array.isArray(playerIds) || playerIds.length === 0) {
        return reply.code(400).send({ error: "Pick at least one player for the round." });
      }
      try {
        const round = startRound(playerIds.map(Number));
        broadcast({ type: "round-changed" });
        return { round };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "Could not start the round." });
      }
    }
  );

  app.post("/api/round/reset", { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    if (!getActiveRound()) return reply.code(400).send({ error: "No round is running." });
    const cleared = clearRoundProgress();
    broadcast({ type: "round-changed" });
    return { ok: true, ...cleared };
  });
}
