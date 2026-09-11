import { useEffect, useRef, useState } from "react";

export type ServerEvent =
  | { type: "match"; gameId: number; gameName: string; thumbnail: string | null }
  | { type: "sync-started" }
  | { type: "sync-progress"; message: string }
  | { type: "library-changed" }
  | { type: "round-changed" }
  | { type: "players-changed" }
  | { type: "sync-finished"; gamesAdded: number; gamesUpdated: number; status: "success" | "error"; error?: string };

/**
 * Live updates, with the assumption that the socket will drop — or never connect at all. Phones
 * suspend it when the screen locks, reverse proxies close idle connections, and a proxy that is
 * not configured to forward the upgrade never establishes one. Anything broadcast while we were
 * away is gone for good, so `onResync` fires whenever the connection is (re)established and
 * whenever the tab becomes visible. The returned `live` flag says whether the socket is actually
 * carrying events; callers poll instead when it is not, so nothing depends on the socket working.
 */
export function useServerEvents(onEvent: (event: ServerEvent) => void, onResync?: () => void) {
  const handlerRef = useRef(onEvent);
  const resyncRef = useRef(onResync);
  handlerRef.current = onEvent;
  resyncRef.current = onResync;

  const [live, setLive] = useState(false);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;

    function connect() {
      if (closed) return;
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

      socket.onopen = () => {
        setLive(true);
        resyncRef.current?.();
      };

      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data));
        } catch {
          // ignore malformed messages
        }
      };

      socket.onclose = () => {
        setLive(false);
        if (!closed) reconnectTimer = setTimeout(connect, 3000);
      };

      // A socket that errors is about to close; let onclose drive the retry.
      socket.onerror = () => socket?.close();
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      resyncRef.current?.();
      // Coming back from a suspended tab the socket is often already dead.
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        clearTimeout(reconnectTimer);
        connect();
      }
    }

    connect();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    };
  }, []);

  return live;
}
