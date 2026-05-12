/**
 * Wire protocol shared between server and browser.
 *
 * Kept deliberately small for Phase 1. Will grow as we implement
 * runs, evidence streaming, and permission flow.
 */

// ─── Sessions ──────────────────────────────────────────────────────────────

export type SessionKind = "tracked_task" | "freeform" | "pr_verification";

export type SessionStatus = "active" | "parked" | "archived";

export interface Session {
  id: string;
  kind: SessionKind;
  title: string;
  prompt: string | null;
  repo: string | null;
  repoPath: string | null;
  taskRef: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

// ─── Attempts ──────────────────────────────────────────────────────────────

export type AttemptKind =
  | "baseline"
  | "investigation"
  | "implementation"
  | "verification"
  | "freeform";

export type AttemptState =
  | "created"
  | "worktree_ready"
  | "agent_running"
  | "waiting_for_user"
  | "running_command"
  | "paused"
  | "verification_pending"
  | "verification_passed"
  | "verification_failed"
  | "review_ready"
  | "pr_opened"
  | "archived";

export type Sandbox =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export interface Attempt {
  id: string;
  sessionId: string;
  name: string;
  kind: AttemptKind;
  state: AttemptState;
  sandbox: Sandbox;
  worktreePath: string | null;
  branch: string | null;
  baseSha: string | null;
  isCandidate: boolean;
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

export interface ServerAttemptCreated {
  type: "attempt_created";
  attempt: Attempt;
}

export interface ServerAttemptUpdated {
  type: "attempt_updated";
  attempt: Attempt;
}

export type ServerMessage =
  | ServerHello
  | ServerPing
  | ServerSessionCreated
  | ServerSessionUpdated
  | ServerAttemptCreated
  | ServerAttemptUpdated;

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
  repoPath?: string | null;
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

export interface CreateAttemptRequest {
  name?: string;
  kind?: AttemptKind;
  sandbox?: Sandbox;
  baseBranch?: string;
}

export interface CreateAttemptResponse {
  attempt: Attempt;
}

export interface ListAttemptsResponse {
  attempts: Attempt[];
}

export interface GetAttemptResponse {
  attempt: Attempt;
}
