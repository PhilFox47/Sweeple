import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import cron from "node-cron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./db.js";
import authRoutes from "./routes/auth.js";
import gamesRoutes from "./routes/games.js";
import importRoutes from "./routes/import.js";
import matchesRoutes from "./routes/matches.js";
import swipesRoutes from "./routes/swipes.js";
import syncRoutes from "./routes/sync.js";
import { runSync } from "./sync.js";
import { registerClient } from "./ws.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = process.env.CLIENT_DIST ?? join(__dirname, "../public");

const app = Fastify({ logger: true });

await app.register(cors, { origin: process.env.CORS_ORIGIN ?? true, credentials: true });
await app.register(cookie);
await app.register(websocket);

app.get("/ws", { websocket: true }, (socket) => {
  registerClient(socket);
});

await app.register(authRoutes);
await app.register(gamesRoutes);
await app.register(importRoutes);
await app.register(swipesRoutes);
await app.register(matchesRoutes);
await app.register(syncRoutes);

await app.register(fastifyStatic, {
  root: CLIENT_DIST,
});

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url?.startsWith("/api")) {
    reply.code(404).send({ error: "Not found" });
    return;
  }
  reply.sendFile("index.html");
});

// Weekly BGG sync, Sunday at 4am server time. Manual sync is also available via POST /api/sync.
cron.schedule("0 4 * * 0", () => {
  runSync().catch((err) => app.log.error(err, "Scheduled BGG sync failed"));
});

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
