import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { authenticate } from "../auth.js";
import { reconcileMatches } from "../matching.js";
import { activeRoundId } from "../rounds.js";

export default async function swipesRoutes(app: FastifyInstance) {
  app.post<{ Body: { gameId: number; decision: "like" | "dislike" } }>(
    "/api/swipes",
    { preHandler: authenticate },
    async (request, reply) => {
      const { gameId, decision } = request.body ?? ({} as any);
      if (!gameId || (decision !== "like" && decision !== "dislike")) {
        return reply.code(400).send({ error: "gameId and decision ('like'|'dislike') are required" });
      }
      db.prepare(
        `INSERT INTO swipes (user_id, game_id, decision) VALUES (?, ?, ?)
         ON CONFLICT(user_id, game_id) DO UPDATE SET decision = excluded.decision, created_at = datetime('now')`
      ).run(request.user!.id, gameId, decision);

      // The lasting record. Unlike swipes it is never cleared, and one row per round means
      // changing your mind corrects tonight's vote rather than adding a second one.
      db.prepare(
        `INSERT INTO votes (user_id, game_id, round_id, decision) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, game_id, round_id)
         DO UPDATE SET decision = excluded.decision, created_at = datetime('now')`
      ).run(request.user!.id, gameId, activeRoundId(), decision);

      reconcileMatches();
      return { ok: true };
    }
  );

  app.post("/api/swipes/reset", { preHandler: authenticate }, async (request) => {
    db.prepare("DELETE FROM swipes WHERE user_id = ?").run(request.user!.id);
    // Starting over is about this sitting, so tonight's votes go with it. Earlier rounds stand.
    db.prepare("DELETE FROM votes WHERE user_id = ? AND round_id = ?").run(request.user!.id, activeRoundId());
    // Their likes are gone and their progress is back to nothing, which can raise the bar again.
    reconcileMatches();
    return { ok: true };
  });
}
