/**
 * Wire protocol shared between server and browser.
 *
 * Kept deliberately small for Phase 1. Will grow as we implement
 * attempts, runs, evidence streaming, and permission flow.
 */

// ─── Domain types ──────────────────────────────────────────────────────────

export type SessionKind = "tracked_task" | "freeform" | "pr_verification";

export type SessionStatus = "active" | "parked" | "archived";

export interface Session {
  id: string;
  kind: SessionKind;
  title: string;
  prompt: string | null;
  repo: string | null;
  taskRef: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

// ─── Server → Browser ──────────────────────────────────────────────────────

export interface ServerHello {
  type: "hello";
  server: "range";
  version: string;
  serverTime: number;
}

export interface ServerPing {
  type: "ping";
  t: number;
}

export interface ServerSessionCreated {
  type: "session_created";
  session: Session;
}

export interface ServerSessionUpdated {
  type: "session_updated";
  session: Session;
}

export type ServerMessage =
  | ServerHello
  | ServerPing
  | ServerSessionCreated
  | ServerSessionUpdated;

// ─── Browser → Server ──────────────────────────────────────────────────────

export interface ClientPong {
  type: "pong";
  t: number;
}

export type ClientMessage = ClientPong;

// ─── REST API request/response shapes ─────────────────────────────────────

export interface CreateSessionRequest {
  kind: SessionKind;
  title?: string;
  prompt?: string | null;
  repo?: string | null;
  taskRef?: string | null;
}

export interface CreateSessionResponse {
  session: Session;
}

export interface ListSessionsResponse {
  sessions: Session[];
}

export interface GetSessionResponse {
  session: Session;
}
