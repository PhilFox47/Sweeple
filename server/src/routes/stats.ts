import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth.js";
import { db } from "../db.js";
import { statsForPlayers } from "../stats.js";

export default async function statsRoutes(app: FastifyInstance) {
  /**
   * Your own pick record, or — for an admin — any set of profiles summed together. Everyone can
   * see their own; only the two permanent profiles can look at anyone else's.
   */
  app.get<{ Querystring: { players?: string } }>("/api/stats", { preHandler: authenticate }, async (request, reply) => {
    const me = request.user!;
    const asked = (request.query.players ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);

    const playerIds = asked.length > 0 ? [...new Set(asked)] : [me.id];
    if (me.role !== "core" && playerIds.some((id) => id !== me.id)) {
      return reply.code(403).send({ error: "You can only see your own picks." });
    }

    const games = statsForPlayers(playerIds);
    const totals = games.reduce(
      (acc, g) => ({ likes: acc.likes + g.likes, votes: acc.votes + g.total }),
      { likes: 0, votes: 0 }
    );

    const players = playerIds.length
      ? (db
          .prepare(
            `SELECT id, display_name as displayName FROM users WHERE id IN (${playerIds.map(() => "?").join(",")})`
          )
          .all(...playerIds) as { id: number; displayName: string }[])
      : [];

    return {
      players,
      games,
      summary: {
        games: games.length,
        votes: totals.votes,
        likes: totals.likes,
        ratio: totals.votes ? totals.likes / totals.votes : null,
      },
    };
  });
}
