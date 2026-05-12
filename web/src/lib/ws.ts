import { useSyncExternalStore } from "react";
import type {
  ServerMessage,
  ClientMessage,
} from "@shared/protocol";
import { useAppStore } from "./store";

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

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "hello":
        this.setState({ lastServerHello: msg });
        break;
      case "ping": {
        const pong: ClientMessage = { type: "pong", t: msg.t };
        this.ws?.send(JSON.stringify(pong));
        this.setState({ latencyMs: Date.now() - msg.t });
        break;
      }
      case "session_created":
      case "session_updated":
        useAppStore.getState().upsertSession(msg.session);
        break;
      case "attempt_created":
      case "attempt_updated":
        useAppStore.getState().upsertAttempt(msg.attempt);
        break;
    }
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
      this.handleMessage(msg);
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
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
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

export type { StoreState as WsState };
