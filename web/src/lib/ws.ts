import { useSyncExternalStore } from "react";
import type {
  ServerMessage,
  ClientMessage,
} from "@shared/protocol";
import { useAppStore } from "./store";

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
    // hello + ping are connection-level: they need the live socket
    // (pong reply) and direct state mutation, so they stay here.
    if (msg.type === "hello") {
      this.setState({ lastServerHello: msg });
      return;
    }
    if (msg.type === "ping") {
      const pong: ClientMessage = { type: "pong", t: msg.t };
      this.ws?.send(JSON.stringify(pong));
      this.setState({ latencyMs: Date.now() - msg.t });
      return;
    }
    applyServerMessage(msg);
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

/**
 * Apply a single ServerMessage to the app store. Exported so other
 * paths (e.g. session-view history rehydration) can route persisted
 * events through the same code as live WS events.
 */
export function applyServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "hello":
    case "ping":
      // Connection-level — handled by the live socket, not by this
      // generic dispatcher.
      break;
    case "session_created":
    case "session_updated":
      useAppStore.getState().upsertSession(msg.session);
      break;
    case "session_deleted":
      useAppStore.getState().removeSession(msg.sessionId);
      break;
    case "run_started":
    case "run_finished":
      useAppStore.getState().upsertRun(msg.run);
      break;
    case "run_log":
      useAppStore.getState().appendLog({
        runId: msg.runId,
        stream: msg.stream,
        t: msg.t,
        message: msg.message,
      });
      break;
    case "agent_started":
      useAppStore.getState().patchConversation(msg.sessionId, {
        status: msg.threadId === "<initializing>" ? "starting" : "running",
        threadId: msg.threadId,
        error: null,
      });
      if (msg.threadId !== "<initializing>") {
        useAppStore
          .getState()
          .pushSystemEntry(
            msg.sessionId,
            `Codex thread started · ${msg.threadId}`,
          );
      }
      break;
    case "agent_stopped":
      useAppStore.getState().patchConversation(msg.sessionId, {
        status: "stopped",
        threadId: null,
        turnInFlight: false,
      });
      useAppStore
        .getState()
        .pushSystemEntry(
          msg.sessionId,
          `Codex stopped${msg.reason ? ` · ${msg.reason}` : ""}`,
        );
      break;
    case "agent_turn_started": {
      const store = useAppStore.getState();
      // If the user hasn't sent any message yet for this session,
      // this turn was kicked off server-side (e.g. the initial prompt
      // from the home composer). Push the prompt into the timeline so
      // the user sees what they originally typed.
      const conv = store.conversationsBySession.get(msg.sessionId);
      const hasUser = conv?.entries.some((e) => e.kind === "user");
      if (!hasUser && msg.prompt) {
        store.pushUserMessage(msg.sessionId, msg.prompt);
      } else {
        store.patchConversation(msg.sessionId, { turnInFlight: true });
      }
      break;
    }
    case "agent_turn_finished":
      useAppStore.getState().patchConversation(msg.sessionId, {
        turnInFlight: false,
      });
      break;
    case "agent_item":
      useAppStore.getState().applyAgentItem(msg.sessionId, msg.item);
      break;
    case "agent_message_delta":
      useAppStore
        .getState()
        .applyMessageDelta(msg.sessionId, msg.itemId, msg.delta);
      break;
    case "agent_error":
      useAppStore.getState().patchConversation(msg.sessionId, {
        status: "error",
        error: msg.message,
        turnInFlight: false,
      });
      break;
    case "agent_approval_request":
      useAppStore.getState().appendApproval(msg.sessionId, {
        requestId: msg.requestId,
        kind: msg.kind,
        payload: msg.payload,
        decision: null,
      });
      break;
    case "agent_approval_resolved":
      useAppStore
        .getState()
        .resolveApproval(msg.sessionId, msg.requestId, msg.decision);
      break;
    case "verification_result":
      useAppStore.getState().applyVerificationResult(msg.result);
      break;
    case "run_metrics":
      useAppStore
        .getState()
        .applyRunMetrics(msg.sessionId, msg.runId, msg.metrics);
      break;
    case "run_artifacts":
      useAppStore.getState().setRunArtifacts(msg.runId, msg.artifacts);
      break;
  }
}
