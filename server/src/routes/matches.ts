import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { authenticate } from "../auth.js";

export default async function matchesRoutes(app: FastifyInstance) {
  app.get("/api/matches", { preHandler: authenticate }, async () => {
    const rows = db
      .prepare(
        `SELECT m.id, m.created_at as createdAt, m.played_at as playedAt,
                g.id as gameId, g.name, g.thumbnail, g.image, g.min_players as minPlayers,
                g.max_players as maxPlayers, g.playing_time as playingTime, g.weight
         FROM matches m JOIN games g ON g.id = m.game_id
         ORDER BY m.played_at IS NOT NULL, m.created_at DESC`
      )
      .all();
    return { matches: rows };
  });

  app.post<{ Params: { id: string } }>("/api/matches/:id/played", { preHandler: authenticate }, async (request, reply) => {
    const id = Number(request.params.id);
    const match = db.prepare("SELECT id, game_id as gameId FROM matches WHERE id = ?").get(id) as
      | { id: number; gameId: number }
      | undefined;
    if (!match) return reply.code(404).send({ error: "Match not found" });

    db.prepare("UPDATE matches SET played_at = datetime('now') WHERE id = ?").run(id);
    // Clear swipes so the game can naturally re-enter the deck for a future session.
    db.prepare("DELETE FROM swipes WHERE game_id = ?").run(match.gameId);
    return { ok: true };
  });
}
