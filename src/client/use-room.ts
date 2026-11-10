import { useCallback, useEffect, useRef, useState } from "react";
import { reduce } from "../shared/reduce";
import type { ClientMessage, RoomState } from "../shared/types";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

type Incoming = RoomState & { type?: string };

export function useRoom(role: "edit" | "play" | "remote") {
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const pending = useRef<ClientMessage[]>([]);

  const send = useCallback((message: ClientMessage) => {
    if (message.type !== "text") {
      setState((current) => (current ? reduce(current, message) : current));
    }
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      pending.current.push(message);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retry = 0;
    let poll = 0;
    let socket: WebSocket | null = null;

    const pull = () => {
      fetch("/api/state")
        .then((response) => {
          if (!response.ok) throw new Error("state unavailable");
          return response.json() as Promise<RoomState>;
        })
        .then((next) => setState((current) => (current && next.rev < current.rev ? current : next)))
        .catch(() => undefined);
    };

    const connect = () => {
      if (stopped) return;
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${location.host}/api/room?role=${role}`);
      socketRef.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setStatus("live");
        window.clearInterval(poll);
        poll = 0;
        const queued = pending.current.splice(0);
        for (const message of queued) socket?.send(JSON.stringify(message));
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as Incoming;
        if (data.deck) {
          setState((current) => (current && typeof data.rev === "number" && data.rev < current.rev ? current : data));
        }
      };
      socket.onclose = () => {
        if (stopped || socketRef.current !== socket) return;
        setStatus((current) => (current === "live" ? "reconnecting" : "connecting"));
        if (!poll) poll = window.setInterval(pull, 2000);
        const delay = Math.min(8000, 400 * 2 ** attempt);
        attempt += 1;
        retry = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      window.clearInterval(poll);
      socket?.close();
    };
  }, [role]);

  return { state, status, send };
}
