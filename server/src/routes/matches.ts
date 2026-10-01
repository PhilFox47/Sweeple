import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { authenticate } from "../auth.js";
import { currentThreshold } from "../matching.js";
import { activeRoundId } from "../rounds.js";

export default async function matchesRoutes(app: FastifyInstance) {
  /**
   * Tonight's matches only. Starting a round is a fresh search for something to play, so what
   * the previous sitting agreed on — including what it played — is not part of this list. The
   * rows stay in the database; they are simply not this evening's business.
   */
  app.get("/api/matches", { preHandler: authenticate }, async () => {
    const rows = db
      .prepare(
        `SELECT m.id, m.created_at as createdAt, m.played_at as playedAt, m.kind, m.likes,
                g.id as gameId, g.name, g.thumbnail, g.image, g.min_players as minPlayers,
                g.max_players as maxPlayers, g.playing_time as playingTime, g.weight
         FROM matches m JOIN games g ON g.id = m.game_id
         WHERE m.round_id = ?
         ORDER BY m.played_at IS NOT NULL, m.kind = 'soft', m.likes DESC, m.created_at DESC`
      )
      .all(activeRoundId());

    // So the list can say what a soft match currently takes, and who is nearly done.
    const { players, required, nearlyDone } = currentThreshold();
    return { matches: rows, threshold: { players, required, nearlyDone } };
  });

  app.post<{ Params: { id: string } }>("/api/matches/:id/played", { preHandler: authenticate }, async (request, reply) => {
    const id = Number(request.params.id);
    const match = db.prepare("SELECT id FROM matches WHERE id = ?").get(id) as { id: number } | undefined;
    if (!match) return reply.code(404).send({ error: "Match not found" });

    // Swipes are left alone. Clearing them used to be how a played game came round again, but a
    // new round wipes them anyway — doing it here only put tonight's game back into tonight's
    // deck and knocked everyone's progress back, which could withdraw soft matches.
    db.prepare("UPDATE matches SET played_at = datetime('now') WHERE id = ?").run(id);
    return { ok: true };
  });
}
