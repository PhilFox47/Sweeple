import type { FastifyInstance } from "fastify";
import { authenticate, requireAdmin } from "../auth.js";
import { collectionUrl, configuredToken, parseCollectionXml, parsePlaysXml, parseThingXml, thingUrl } from "../bgg.js";
import { applyCollection, applyDetails, applyPlays, gamesMissingDetails } from "../store.js";
import { db } from "../db.js";
import { broadcast } from "../ws.js";

const DETAIL_CHUNK = 20;

function detectKind(xml: string): "collection" | "thing" | "plays" | null {
  if (/<plays\b/i.test(xml)) return "plays";
  // A collection lists <item objecttype="thing" ...>; thing responses use <item type="boardgame">.
  if (/<items\b/i.test(xml)) return /objecttype=/i.test(xml) ? "collection" : "thing";
  return null;
}

export default async function importRoutes(app: FastifyInstance) {
  app.get("/api/import/links", { preHandler: [authenticate, requireAdmin] }, async () => {
    const username = process.env.BGG_USERNAME ?? "";
    const missing = gamesMissingDetails();
    const detailBatches: { url: string; count: number }[] = [];
    for (let i = 0; i < missing.length; i += DETAIL_CHUNK) {
      const chunk = missing.slice(i, i + DETAIL_CHUNK);
      detailBatches.push({ url: thingUrl(chunk), count: chunk.length });
    }

    const totals = db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN weight IS NULL THEN 0 ELSE 1 END) AS withDetails FROM games WHERE owned = 1"
      )
      .get() as { total: number; withDetails: number | null };

    return {
      username,
      hasToken: Boolean(configuredToken()),
      collectionUrl: collectionUrl(username),
      playsUrl: `https://boardgamegeek.com/xmlapi2/plays?username=${encodeURIComponent(username)}`,
      detailBatches,
      gamesTotal: totals.total,
      gamesWithDetails: totals.withDetails ?? 0,
    };
  });

  app.post<{ Body: { xml: string } }>("/api/import", { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const xml = request.body?.xml?.trim();
    if (!xml) return reply.code(400).send({ error: "Paste the BGG response first." });

    const kind = detectKind(xml);
    if (!kind) {
      return reply.code(400).send({
        error:
          "Could not recognise that as a BGG response. Expected the XML from a collection, thing or plays URL.",
      });
    }

    try {
      if (kind === "collection") {
        const items = parseCollectionXml(xml);
        if (items.length === 0) {
          return reply.code(400).send({
            error:
              "That collection response contains no games. If it says the request is being processed, " +
              "reload the BGG page a few seconds later and paste the result.",
          });
        }
        const result = applyCollection(items);
        broadcast({ type: "library-changed" });
        return {
          kind,
          message: `Imported ${items.length} games (${result.added} new, ${result.updated} updated${
            result.markedUnowned ? `, ${result.markedUnowned} no longer owned` : ""
          }).`,
          ...result,
        };
      }

      if (kind === "thing") {
        const details = parseThingXml(xml);
        if (details.length === 0) return reply.code(400).send({ error: "No games found in that response." });
        const result = applyDetails(details);
        broadcast({ type: "library-changed" });
        const expansions = details.filter((d) => d.isExpansion).length;
        return {
          kind,
          message:
            `Updated details for ${result.updated} games` +
            (expansions ? `, ${expansions} identified as expansions` : "") +
            (result.unknown ? `. ${result.unknown} were not in your library — import the collection first.` : "."),
          ...result,
        };
      }

      const plays = parsePlaysXml(xml);
      const result = applyPlays(plays);
      broadcast({ type: "library-changed" });
      return {
        kind,
        message: `Updated play history for ${result.updated} games from ${plays.size} entries.`,
        ...result,
      };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Could not parse that response." });
    }
  });
}
