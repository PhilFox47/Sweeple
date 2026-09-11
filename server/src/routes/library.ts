import type { FastifyInstance } from "fastify";
import { authenticate, requireAdmin } from "../auth.js";
import { db } from "../db.js";
import { EMPTY_RATING, gameRatings } from "../stats.js";
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

/** Words used for matching: lower case, punctuation flattened. */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function commonPrefix(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) out.push(a[i]);
  return out;
}

/**
 * Groups games that are clearly boxes of the same thing — Disney Villainous, Dice Throne, the
 * Crew — so one can be kept and the rest hidden. BGG is no help here: it calls most of them
 * standalone base games, which is true but not what you want filling up a swipe deck.
 *
 * Detection is on the names alone: sorted alphabetically, boxes of a series land next to each
 * other, and two or more leading words in common is a series. One word is only enough when it is
 * the whole of the shorter name, which is how a one-word base game meets its boxes ("Carcassonne"
 * and "Carcassonne: Inns & Cathedrals"). Otherwise one word means nothing — "Dead of Winter" and
 * "Dead Man's Cabal" are not related.
 */
/**
 * The series name, taken from one member's own spelling. A subtitle marker ends it even when the
 * boxes share more words than that: "Dice Throne: Season One" and "Dice Throne: Season Two" have
 * three words in common, but the series is Dice Throne.
 */
function labelFor(name: string, wordCount: number): string {
  const tokens = name.split(/\s+/).slice(0, wordCount);
  const end = tokens.findIndex((t) => /[:–—]$/.test(t));
  const kept = end === -1 ? tokens : tokens.slice(0, end + 1);
  return kept.join(" ").replace(/[\s:–—-]+$/, "");
}

export function detectSeries(names: { id: number; name: string }[]): Map<number, string> {
  const sorted = [...names].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const groups: { prefix: string[]; label: string; ids: number[] }[] = [];

  for (const game of sorted) {
    const w = words(game.name);
    const current = groups[groups.length - 1];
    if (current) {
      const shared = commonPrefix(current.prefix, w);
      const isWholeName = shared.length === Math.min(current.prefix.length, w.length);
      if (shared.length >= 2 || (isWholeName && shared.join("").length >= 4)) {
        current.prefix = shared;
        current.label = labelFor(game.name, shared.length);
        current.ids.push(game.id);
        continue;
      }
    }
    groups.push({ prefix: w, label: game.name, ids: [game.id] });
  }

  const series = new Map<number, string>();
  for (const group of groups) {
    if (group.ids.length < 2) continue;
    for (const id of group.ids) series.set(id, group.label);
  }
  return series;
}

export default async function libraryRoutes(app: FastifyInstance) {
  /**
   * The whole owned library, because anything can be worth hiding: an expansion BGG flagged, or
   * the fourth Villainous box it calls a base game.
   */
  app.get("/api/library", { preHandler: [authenticate, requireAdmin] }, async () => {
    const rows = db
      .prepare(
        `SELECT id, name, thumbnail, min_players, max_players, is_expansion, expansion_mode
         FROM games
         WHERE owned = 1
         ORDER BY name COLLATE NOCASE`
      )
      .all() as Row[];

    const series = detectSeries(rows);
    const ratings = gameRatings();

    return {
      games: rows.map((r) => ({
        id: r.id,
        name: r.name,
        thumbnail: r.thumbnail,
        minPlayers: r.min_players,
        maxPlayers: r.max_players,
        isExpansion: !!r.is_expansion,
        mode: (r.expansion_mode ?? "auto") as Mode,
        series: series.get(r.id) ?? null,
        rating: ratings.get(r.id) ?? EMPTY_RATING,
        // What the deck does with it today, once the override is applied.
        hidden: r.expansion_mode === "hidden" || (r.expansion_mode === "auto" && !!r.is_expansion),
      })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { mode: Mode } }>(
    "/api/library/:id",
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
