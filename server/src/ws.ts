import type { WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function registerClient(socket: WebSocket) {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
}

export type ServerEvent =
  | { type: "match"; gameId: number; gameName: string; thumbnail: string | null }
  | { type: "sync-started" }
  | { type: "sync-progress"; message: string }
  | { type: "library-changed" }
  | { type: "sync-finished"; gamesAdded: number; gamesUpdated: number; status: "success" | "error"; error?: string };

export function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
