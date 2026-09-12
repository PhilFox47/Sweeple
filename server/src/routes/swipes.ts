import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { authenticate } from "../auth.js";
import { activeRoundId, matchParticipantIds } from "../rounds.js";
import { broadcast } from "../ws.js";

function reconcileMatch(gameId: number) {
  // Everyone playing this round has to agree, not just the two permanent profiles.
  const participants = matchParticipantIds();
  if (participants.length === 0) return;

  const likes = db
    .prepare("SELECT user_id FROM swipes WHERE game_id = ? AND decision = 'like'")
    .all(gameId) as { user_id: number }[];
  const likedUserIds = new Set(likes.map((l) => l.user_id));
  const allCoreLiked = participants.every((id) => likedUserIds.has(id));

  // Scoped to this sitting: what an earlier evening agreed on has no bearing on tonight.
  const roundId = activeRoundId();
  const existingMatch = db
    .prepare("SELECT id, played_at FROM matches WHERE game_id = ? AND round_id = ?")
    .get(gameId, roundId) as { id: number; played_at: string | null } | undefined;

  if (allCoreLiked && !existingMatch) {
    db.prepare("INSERT INTO matches (game_id, round_id) VALUES (?, ?)").run(gameId, roundId);
    const game = db.prepare("SELECT name, thumbnail FROM games WHERE id = ?").get(gameId) as
      | { name: string; thumbnail: string | null }
      | undefined;
    broadcast({ type: "match", gameId, gameName: game?.name ?? "Unknown game", thumbnail: game?.thumbnail ?? null });
  } else if (!allCoreLiked && existingMatch && !existingMatch.played_at) {
    db.prepare("DELETE FROM matches WHERE id = ?").run(existingMatch.id);
  }
}

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

      reconcileMatch(gameId);
      return { ok: true };
    }
  );

  app.post("/api/swipes/reset", { preHandler: authenticate }, async (request) => {
    const gameIds = (
      db.prepare("SELECT game_id FROM swipes WHERE user_id = ?").all(request.user!.id) as { game_id: number }[]
    ).map((r) => r.game_id);
    db.prepare("DELETE FROM swipes WHERE user_id = ?").run(request.user!.id);
    // Starting over is about this sitting, so tonight's votes go with it. Earlier rounds stand.
    db.prepare("DELETE FROM votes WHERE user_id = ? AND round_id = ?").run(request.user!.id, activeRoundId());
    for (const gameId of gameIds) reconcileMatch(gameId);
    return { ok: true };
  });
}
