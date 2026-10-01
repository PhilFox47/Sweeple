import type { FastifyInstance } from "fastify";
import { authenticate, requireAdmin } from "../auth.js";
import { collectionUrl, configuredToken, parseCollectionXml, parsePlaysXml, parseThingXml, thingUrl } from "../bgg.js";
import { applyCollection, applyDetails, applyPlays, gamesMissingDetails } from "../store.js";
import { db } from "../db.js";
import { generateMissingSummaries } from "../summaries.js";
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
    if (!xml) return reply.code(400).send({ error: "Zuerst die Antwort von BGG einfügen." });

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
              "Diese Sammlung enthält keine Spiele. Falls dort steht, dass die Anfrage bearbeitet wird, " +
              "die BGG-Seite nach ein paar Sekunden neu laden und das Ergebnis einfügen.",
          });
        }
        const result = applyCollection(items);
        broadcast({ type: "library-changed" });
        return {
          kind,
          message: `${items.length} Spiele importiert (${result.added} neu, ${result.updated} aktualisiert${
            result.markedUnowned ? `, ${result.markedUnowned} nicht mehr im Besitz` : ""
          }).`,
          ...result,
        };
      }

      if (kind === "thing") {
        const details = parseThingXml(xml);
        if (details.length === 0) return reply.code(400).send({ error: "In dieser Antwort sind keine Spiele." });
        const result = applyDetails(details);
        broadcast({ type: "library-changed" });
        // Details are what a summary is written from, so this is when one becomes possible.
        void generateMissingSummaries();
        const expansions = details.filter((d) => d.isExpansion).length;
        return {
          kind,
          message:
            `Details für ${result.updated} Spiele aktualisiert` +
            (expansions ? `, ${expansions} davon Erweiterungen` : "") +
            (result.unknown ? `. ${result.unknown} sind nicht in der Bibliothek — zuerst die Sammlung importieren.` : "."),
          ...result,
        };
      }

      const plays = parsePlaysXml(xml);
      const result = applyPlays(plays);
      broadcast({ type: "library-changed" });
      return {
        kind,
        message: `Partien für ${result.updated} Spiele aus ${plays.size} Einträgen aktualisiert.`,
        ...result,
      };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Diese Antwort konnte nicht gelesen werden." });
    }
  });
}
