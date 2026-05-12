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
  codexThreadId: string | null;
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

// ─── Profile (range.yaml) ──────────────────────────────────────────────────

/**
 * A profile is the project's declaration of how Range orchestrates its
 * stack. Loaded from <repo_path>/range.yaml.
 *
 * MVP scope: project metadata + named commands. Scenarios, metrics,
 * verification rules, runners, and approvals are reserved for Phase 2.
 */

export interface ProfileCommand {
  name: string;
  args: string[]; // executable + args, e.g. ["pytest", "tests/"]
  description?: string;
}

export interface Profile {
  version: number;
  project: {
    name: string;
    description?: string;
    stack?: string;
    language?: string;
  };
  commands: ProfileCommand[];
}

export interface ProfileLoadResult {
  profile: Profile | null;
  /** Absolute path of the range.yaml we tried to read. */
  path: string;
  /** True if range.yaml existed at all. */
  found: boolean;
  /** Parse / validation error, if any. */
  error: string | null;
}

export interface GetProfileResponse {
  result: ProfileLoadResult;
}

// ─── Agent events (Codex item lifecycle) ──────────────────────────────────

/**
 * Agent items as observed from Codex. The codex app-server emits
 * `item/started` → optional `item/updated` → `item/completed`, plus
 * `item/agentMessage/delta` for streaming text chunks. We translate
 * those into a small set of Range-native event types so the UI never
 * sees the raw Codex protocol shape.
 */

export type AgentItemKind =
  | "message"
  | "reasoning"
  | "command"
  | "file_edit"
  | "mcp_tool"
  | "web_search"
  | "unknown";

export type AgentItemState = "started" | "completed";

export interface AgentMessageItem {
  id: string;
  kind: "message";
  state: AgentItemState;
  text: string; // accumulated text up to this point
}

export interface AgentReasoningItem {
  id: string;
  kind: "reasoning";
  state: AgentItemState;
  text: string;
}

export interface AgentCommandItem {
  id: string;
  kind: "command";
  state: AgentItemState;
  command: string | string[];
  cwd?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  output?: string; // captured at completion
}

export interface AgentFileEditItem {
  id: string;
  kind: "file_edit";
  state: AgentItemState;
  path: string;
  changeKind: "create" | "edit" | "delete" | "modify";
  summary?: string;
}

export interface AgentMcpToolItem {
  id: string;
  kind: "mcp_tool";
  state: AgentItemState;
  server?: string;
  tool?: string;
  output?: string;
}

export interface AgentWebSearchItem {
  id: string;
  kind: "web_search";
  state: AgentItemState;
  query?: string;
  result?: string;
}

export interface AgentUnknownItem {
  id: string;
  kind: "unknown";
  state: AgentItemState;
  raw: unknown;
}

export type AgentItem =
  | AgentMessageItem
  | AgentReasoningItem
  | AgentCommandItem
  | AgentFileEditItem
  | AgentMcpToolItem
  | AgentWebSearchItem
  | AgentUnknownItem;

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

// Agent / Codex events ───
export interface ServerAgentStarted {
  type: "agent_started";
  attemptId: string;
  threadId: string;
}

export interface ServerAgentStopped {
  type: "agent_stopped";
  attemptId: string;
  reason?: string;
}

export interface ServerAgentTurnStarted {
  type: "agent_turn_started";
  attemptId: string;
  turnId: string;
  prompt: string;
}

export interface ServerAgentTurnFinished {
  type: "agent_turn_finished";
  attemptId: string;
  turnId: string;
  status: "ok" | "failed" | "aborted";
}

export interface ServerAgentItem {
  type: "agent_item";
  attemptId: string;
  item: AgentItem;
}

export interface ServerAgentMessageDelta {
  type: "agent_message_delta";
  attemptId: string;
  itemId: string;
  delta: string;
}

export interface ServerAgentError {
  type: "agent_error";
  attemptId: string;
  message: string;
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
  | ServerRunFinished
  | ServerAgentStarted
  | ServerAgentStopped
  | ServerAgentTurnStarted
  | ServerAgentTurnFinished
  | ServerAgentItem
  | ServerAgentMessageDelta
  | ServerAgentError;

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

// Agent (Codex) endpoints ───

export interface StartAgentResponse {
  attempt: Attempt; // attempt with codexThreadId populated
}

export interface AgentMessageRequest {
  prompt: string;
}

export interface AgentMessageResponse {
  turnId: string;
}

export interface ListAgentItemsResponse {
  items: AgentItem[];
}
