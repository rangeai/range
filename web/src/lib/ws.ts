import { useEffect, useSyncExternalStore } from "react";
import type {
  ServerMessage,
  ClientMessage,
} from "@shared/protocol";

/**
 * Minimal WebSocket client with auto-reconnect and an external-store API
 * so React can subscribe via `useSyncExternalStore` (no extra re-renders
 * on unrelated state changes).
 */

type ConnectionState =
  | { phase: "connecting" }
  | { phase: "open"; openedAt: number }
  | { phase: "closed"; reason?: string }
  | { phase: "reconnecting"; attempt: number };

interface StoreState {
  connection: ConnectionState;
  lastServerHello: Extract<ServerMessage, { type: "hello" }> | null;
  latencyMs: number | null;
}

type Listener = () => void;

class WsStore {
  private state: StoreState = {
    connection: { phase: "connecting" },
    lastServerHello: null,
    latencyMs: null,
  };
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private url: string;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  getSnapshot = (): StoreState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private setState(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private connect() {
    this.setState({
      connection:
        this.reconnectAttempts === 0
          ? { phase: "connecting" }
          : { phase: "reconnecting", attempt: this.reconnectAttempts },
    });

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState({
        connection: { phase: "open", openedAt: Date.now() },
      });
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        console.warn("[ws] non-JSON message:", event.data);
        return;
      }
      switch (msg.type) {
        case "hello":
          this.setState({ lastServerHello: msg });
          break;
        case "ping": {
          const pong: ClientMessage = { type: "pong", t: msg.t };
          ws.send(JSON.stringify(pong));
          // Latency = time the ping took to roundtrip with us (approx).
          this.setState({ latencyMs: Date.now() - msg.t });
          break;
        }
      }
    };

    ws.onclose = (event) => {
      this.ws = null;
      this.setState({
        connection: { phase: "closed", reason: event.reason || undefined },
      });
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // close handler will run after this; nothing to do here.
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      15_000,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts += 1;
      this.connect();
    }, delay);
  }
}

const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
const store = new WsStore(wsUrl);

export function useWsState(): StoreState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useWsSend(): (msg: ClientMessage) => void {
  return (msg) => store.send(msg);
}

// Re-export the snapshot type for convenience.
export type { StoreState as WsState };

// Eagerly read the store once during module init so SSR or hot-reload
// don't see an undefined state.
export const _initialSnapshot = store.getSnapshot();

// Suppress unused-import-style warnings during scaffold.
void useEffect;
