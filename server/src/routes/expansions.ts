import type { FastifyInstance } from "fastify";
import { authenticate, requireAdmin } from "../auth.js";
import { db } from "../db.js";
import { broadcast } from "../ws.js";

const MODES = ["auto", "hidden", "standalone"] as const;
type Mode = (typeof MODES)[number];

interface Row {
  id: number;
  name: string;
  thumbnail: string | null;
  min_players: number | null;
  max_players: number | null;
  is_expansion: number;
  expansion_mode: string;
}

export default async function expansionRoutes(app: FastifyInstance) {
  /**
   * Everything BGG flagged as an expansion, plus anything overridden by hand — a game marked
   * "standalone" has to stay listed or there would be no way to change your mind.
   */
  app.get("/api/expansions", { preHandler: [authenticate, requireAdmin] }, async () => {
    const rows = db
      .prepare(
        `SELECT id, name, thumbnail, min_players, max_players, is_expansion, expansion_mode
         FROM games
         WHERE owned = 1 AND (is_expansion = 1 OR expansion_mode <> 'auto')
         ORDER BY name COLLATE NOCASE`
      )
      .all() as Row[];

    return {
      expansions: rows.map((r) => ({
        id: r.id,
        name: r.name,
        thumbnail: r.thumbnail,
        minPlayers: r.min_players,
        maxPlayers: r.max_players,
        isExpansion: !!r.is_expansion,
        mode: (r.expansion_mode ?? "auto") as Mode,
        // What the deck currently does with it, once the override is applied.
        hidden: r.expansion_mode === "hidden" || (r.expansion_mode === "auto" && !!r.is_expansion),
      })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { mode: Mode } }>(
    "/api/expansions/:id",
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const mode = request.body?.mode;
      if (!MODES.includes(mode)) {
        return reply.code(400).send({ error: `mode must be one of ${MODES.join(", ")}` });
      }
      const changed = db.prepare("UPDATE games SET expansion_mode = ? WHERE id = ?").run(mode, id).changes;
      if (changed === 0) return reply.code(404).send({ error: "No such game." });

      broadcast({ type: "library-changed" });
      return { ok: true, id, mode };
    }
  );
}
