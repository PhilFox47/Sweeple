import { useEffect, useRef } from "react";

export type ServerEvent =
  | { type: "match"; gameId: number; gameName: string; thumbnail: string | null }
  | { type: "sync-started" }
  | { type: "sync-progress"; message: string }
  | { type: "library-changed" }
  | { type: "round-changed" }
  | { type: "players-changed" }
  | { type: "sync-finished"; gamesAdded: number; gamesUpdated: number; status: "success" | "error"; error?: string };

export function useServerEvents(onEvent: (event: ServerEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data));
        } catch {
          // ignore malformed messages
        }
      };
      socket.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);
}
