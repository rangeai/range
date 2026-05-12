/**
 * Wire protocol shared between server and browser.
 *
 * Kept deliberately small for Phase 1. Will grow as we implement
 * evidence streaming and permission flow.
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

// ─── Runs ──────────────────────────────────────────────────────────────────

export type RunKind =
  | "reproduce"
  | "verify"
  | "evaluate"
  | "train"
  | "render"
  | "shell"
  | "agent";

export type RunState =
  | "queued"
  | "starting"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "aborted"
  | "failed_start";

export interface Run {
  id: string;
  attemptId: string;
  kind: RunKind;
  command: string[];
  cwd: string;
  state: RunState;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  runDir: string;
  createdAt: number;
  updatedAt: number;
}

export type LogStream = "stdout" | "stderr" | "system";

export interface RunLogEntry {
  runId: string;
  stream: LogStream;
  t: number; // ms offset from run.startedAt
  message: string;
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

export interface ServerRunStarted {
  type: "run_started";
  run: Run;
}

export interface ServerRunLog {
  type: "run_log";
  runId: string;
  stream: LogStream;
  t: number;
  message: string;
}

export interface ServerRunFinished {
  type: "run_finished";
  run: Run;
}

export type ServerMessage =
  | ServerHello
  | ServerPing
  | ServerSessionCreated
  | ServerSessionUpdated
  | ServerAttemptCreated
  | ServerAttemptUpdated
  | ServerRunStarted
  | ServerRunLog
  | ServerRunFinished;

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

export interface CreateRunRequest {
  command: string | string[]; // string is split on whitespace, array is used as-is
  kind?: RunKind;
}

export interface CreateRunResponse {
  run: Run;
}

export interface ListRunsResponse {
  runs: Run[];
}

export interface GetRunResponse {
  run: Run;
  logs?: RunLogEntry[]; // recent log entries, if requested
}
