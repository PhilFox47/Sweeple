import type { WebSocket } from "ws";

const clients = new Set<WebSocket>();

/**
 * Reverse proxies close idle connections (nginx defaults to 60s), and a silently dead socket
 * means missed matches. Ping regularly so the connection stays warm and dead peers are dropped.
 */
const HEARTBEAT_MS = 25_000;

export function registerClient(socket: WebSocket) {
  clients.add(socket);

  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });

  const heartbeat = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, HEARTBEAT_MS);

  const drop = () => {
    clearInterval(heartbeat);
    clients.delete(socket);
  };
  socket.on("close", drop);
  socket.on("error", drop);
}

export type ServerEvent =
  | { type: "match"; gameId: number; gameName: string; thumbnail: string | null }
  | { type: "sync-started" }
  | { type: "sync-progress"; message: string }
  | { type: "library-changed" }
  | { type: "round-changed" }
  | { type: "players-changed" }
  | { type: "sync-finished"; gamesAdded: number; gamesUpdated: number; status: "success" | "error"; error?: string };

export function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
