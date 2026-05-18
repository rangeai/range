/**
 * Wire protocol shared between server and browser.
 *
 * The MVP collapses attempts into sessions: each session owns one
 * worktree, one Codex thread, and one stream of runs. "Attempts" as
 * a top-level concept is removed. If we ever need parallel exploration
 * inside a session again, we can reintroduce it without breaking this
 * surface.
 */

// ─── Sessions ──────────────────────────────────────────────────────────────

export type SessionKind = "tracked_task" | "freeform" | "pr_verification";

export type SessionStatus = "active" | "parked" | "archived";

export type Sandbox =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export interface Session {
  id: string;
  kind: SessionKind;
  title: string;
  prompt: string | null;
  repo: string | null;
  repoPath: string | null;
  taskRef: string | null;
  status: SessionStatus;
  worktreePath: string | null;
  branch: string | null;
  baseSha: string | null;
  codexThreadId: string | null;
  sandbox: Sandbox;
  /** Skip approval for every command. Maps to Codex approval_policy = "never". */
  autoApprove: boolean;
  /** Binaries (first non-shell token) whose commands auto-approve in this
   *  session. e.g. ["git", "ls", "find"]. */
  allowedCommands: string[];
  /** Underlying LLM the active agent backend should use.
   *  For Codex: a model id like "gpt-5" or "claude-sonnet-4.5".
   *  For OpenCode: the model id portion of `{providerID, modelID}`
   *  — the provider lives in `modelProvider`.
   *  Null means use the backend's default. */
  model: string | null;
  /** Optional provider id when `model` alone is ambiguous (OpenCode
   *  needs both). Null for Codex sessions. */
  modelProvider: string | null;
  /** Reasoning effort hint forwarded to Codex's thread/start. */
  reasoningEffort: "low" | "medium" | "high" | null;
  /** Which agent backend powers this session. Defaults to "codex"
   *  for sessions created before the backend column existed. */
  backend: AgentBackendName;
  createdAt: number;
  updatedAt: number;
}

export type AgentBackendName = "codex" | "opencode";

export type ReasoningEffort = "low" | "medium" | "high";

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

/**
 * Free-form metric snapshot a run drops into `${runDir}/metrics.json`.
 * Range parses it after the run completes and surfaces it as chips.
 * Values are kept loose so different sims can converge later.
 */
export type MetricValue = number | string | boolean;
export type MetricsSnapshot = Record<string, MetricValue>;

export interface Run {
  id: string;
  sessionId: string;
  kind: RunKind;
  command: string[];
  cwd: string;
  state: RunState;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  runDir: string;
  /** Scenario this run was launched from, if any. */
  scenarioName: string | null;
  /** Sweep this run belongs to; multiple runs share this id. */
  sweepId: string | null;
  /** This run's variant within its sweep (e.g. `{ seed: 3 }`). */
  sweepVariant: Record<string, string | number> | null;
  /** Parsed metrics.json contents once the run finishes (if any). */
  metrics: MetricsSnapshot | null;
  createdAt: number;
  updatedAt: number;
}

export type LogStream = "stdout" | "stderr" | "system";

export interface RunLogEntry {
  runId: string;
  stream: LogStream;
  t: number;
  message: string;
}

// ─── Profile ───────────────────────────────────────────────────────────────

export interface ProfileCommand {
  name: string;
  args: string[];
  description?: string;
}

export interface VerificationCriterion {
  exitCode?: number;
  stdoutContains?: string;
  stderrContains?: string;
  stdoutMissing?: string;
}

export interface VerificationGate {
  name: string;
  command: string;
  pass?: VerificationCriterion;
  warn?: VerificationCriterion;
  description?: string;
}

/**
 * A scenario is a parameterized, repeatable launch — sim runs, evaluation
 * sweeps, benchmark variants. Distinct from `commands` (one-off utilities
 * like `format` or `test-lite`) because scenarios carry metric/sweep
 * semantics the IDE knows how to execute.
 */
export interface ScenarioSweep {
  /** Each key is exposed to the run as RANGE_<KEY uppercased>=<value>. */
  params: Record<string, (string | number)[]>;
}

export interface Scenario {
  name: string;
  /** Either a reference to a `commands` entry by name, or inline args. */
  command?: string;
  args?: string[];
  /** Static env vars added to every launch of this scenario. */
  env?: Record<string, string>;
  /** Sweep over param values, fanning out to one run per combination. */
  sweep?: ScenarioSweep;
  description?: string;
}

/** A reward function — a method on an env class that contributes
 *  to the per-step reward. Declared in `range.yaml` so Range can
 *  show it inline, A/B compare variants, etc. */
export interface ProfileRewardFunction {
  name: string;
  file: string;
  /** The Python method name within `file`, e.g. `_reward_tracking_lin_vel`. */
  function: string;
  description?: string;
}

/** A checkpoint glob pattern — where the user's training script
 *  writes policy snapshots. `/eval checkpoint=<path>` re-runs a
 *  scenario against a frozen checkpoint. */
export interface ProfileCheckpoint {
  name: string;
  pattern: string;
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
  scenarios: Scenario[];
  gates: VerificationGate[];
  rewardFunctions: ProfileRewardFunction[];
  checkpoints: ProfileCheckpoint[];
}

export type VerificationStatus = "pass" | "warn" | "fail" | "error";

export interface VerificationResult {
  sessionId: string;
  runId: string;
  gateName: string;
  status: VerificationStatus;
  reason: string;
  evaluatedAt: number;
}

export interface ProfileLoadResult {
  profile: Profile | null;
  path: string;
  found: boolean;
  error: string | null;
}

export interface GetProfileResponse {
  result: ProfileLoadResult;
}

// ─── Agent (Codex item lifecycle) ─────────────────────────────────────────

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
  text: string;
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
  output?: string;
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

export interface ServerSessionDeleted {
  type: "session_deleted";
  sessionId: string;
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

export interface ServerAgentStarted {
  type: "agent_started";
  sessionId: string;
  threadId: string;
}

export interface ServerAgentStopped {
  type: "agent_stopped";
  sessionId: string;
  reason?: string;
}

export interface ServerAgentTurnStarted {
  type: "agent_turn_started";
  sessionId: string;
  turnId: string;
  prompt: string;
}

export interface ServerAgentTurnFinished {
  type: "agent_turn_finished";
  sessionId: string;
  turnId: string;
  status: "ok" | "failed" | "aborted";
}

export interface ServerAgentItem {
  type: "agent_item";
  sessionId: string;
  item: AgentItem;
}

export interface ServerAgentMessageDelta {
  type: "agent_message_delta";
  sessionId: string;
  itemId: string;
  delta: string;
}

export interface ServerAgentError {
  type: "agent_error";
  sessionId: string;
  message: string;
}

export interface ServerAgentApprovalRequest {
  type: "agent_approval_request";
  sessionId: string;
  requestId: number;
  kind: "command" | "file_edit" | "patch" | "exec" | "permissions" | "unknown";
  // Loose payload — varies by kind
  payload: {
    command?: string | string[];
    cwd?: string;
    path?: string;
    changeKind?: "create" | "edit" | "delete" | "modify";
    description?: string;
    raw?: unknown;
  };
}

export interface ServerAgentApprovalResolved {
  type: "agent_approval_resolved";
  sessionId: string;
  requestId: number;
  decision: "accept" | "decline";
}

export interface ServerVerificationResult {
  type: "verification_result";
  result: VerificationResult;
}

export interface TokenUsageBreakdown {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface ThreadTokenUsage {
  last: TokenUsageBreakdown;
  total: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface ServerAgentTokenUsage {
  type: "agent_token_usage";
  sessionId: string;
  threadId: string;
  turnId: string;
  usage: ThreadTokenUsage;
}

export interface ServerAgentTurnDiff {
  type: "agent_turn_diff";
  sessionId: string;
  threadId: string;
  turnId: string;
  diff: string;
}

export type PlanStepStatus = "pending" | "in_progress" | "completed";

export interface PlanStep {
  step: string;
  status: PlanStepStatus;
}

export interface ServerAgentPlanUpdated {
  type: "agent_plan_updated";
  sessionId: string;
  threadId: string;
  turnId: string;
  plan: PlanStep[];
  explanation: string | null;
}

export interface ServerAgentCompacted {
  type: "agent_compacted";
  sessionId: string;
  threadId: string;
  turnId: string;
}

export interface ServerRunMetrics {
  type: "run_metrics";
  runId: string;
  sessionId: string;
  metrics: MetricsSnapshot;
}

export type ArtifactKind =
  | "usd"
  | "image"
  | "video"
  | "csv"
  | "json"
  | "npy"
  | "mesh"
  | "other";

export interface ArtifactInfo {
  name: string;
  /** Bytes. */
  size: number;
  kind: ArtifactKind;
}

export interface ServerRunArtifacts {
  type: "run_artifacts";
  runId: string;
  sessionId: string;
  artifacts: ArtifactInfo[];
}

// ─── Scaffold proposal (P1: auto-scaffolded range.yaml) ───────────────────

export type ScaffoldStack =
  | "mujoco_playground"
  | "isaac_lab"
  | "generic_python"
  | "unknown";

export interface ScaffoldSummary {
  commands: number;
  scenarios: number;
  rewardFunctions: number;
  checkpoints: number;
}

export interface ScaffoldShim {
  /** Path relative to the repo root where the shim will be written. */
  path: string;
  /** File contents — typically a small Python script that translates
   *  `RANGE_*` env vars into the project's native CLI flags. */
  content: string;
  /** One-line summary for display in the proposal card. */
  description: string;
}

export interface ScaffoldProposal {
  /** Stable id so the same proposal can be referenced by accept/dismiss. */
  proposalId: string;
  stack: ScaffoldStack;
  /** Human-readable label, e.g. "MuJoCo Playground". */
  stackLabel: string;
  /** The proposed range.yaml contents. */
  yamlText: string;
  /** Optional companion script that bridges Range's env-var contract
   *  to the project's CLI. Generated per detected stack — most real
   *  sim training scripts use argparse/absl flags rather than
   *  reading RANGE_* env vars directly. */
  shim?: ScaffoldShim;
  summary: ScaffoldSummary;
  /** Short bullets explaining what was detected and why. */
  notes: string[];
}

export interface ServerScaffoldProposed {
  type: "scaffold_proposed";
  sessionId: string;
  proposal: ScaffoldProposal;
  t: number;
}

export interface ServerScaffoldResolved {
  type: "scaffold_resolved";
  sessionId: string;
  proposalId: string;
  decision: "accepted" | "dismissed";
  t: number;
}

/**
 * Broadcast when `<repoPath>/range.yaml` changes on disk — covers
 * scaffold-accept, agent apply_patch, and manual user edits. Clients
 * should re-fetch `/api/sessions/:id/profile` on this event so the
 * slash picker + scenario list stay in sync.
 */
export interface ServerProfileChanged {
  type: "profile_changed";
  sessionId: string;
  t: number;
}

// ─── Wire proposal (P3: /wire wandb-hydra) ────────────────────────────────

export type WireKind = "wandb-hydra";

export interface WirePatch {
  /** Path relative to the repo root. */
  path: string;
  oldText: string;
  newText: string;
  changes: string[];
}

export interface WireProposal {
  proposalId: string;
  kind: WireKind;
  detected: {
    hydra: boolean;
    wandb: boolean;
    hydraSignals: string[];
    wandbSignals: string[];
  };
  patches: WirePatch[];
  notes: string[];
}

export interface ServerWireProposed {
  type: "wire_proposed";
  sessionId: string;
  proposal: WireProposal;
  t: number;
}

export interface ServerWireResolved {
  type: "wire_resolved";
  sessionId: string;
  proposalId: string;
  decision: "accepted" | "dismissed";
  t: number;
}

export type ServerMessage =
  | ServerHello
  | ServerPing
  | ServerSessionCreated
  | ServerSessionUpdated
  | ServerSessionDeleted
  | ServerRunStarted
  | ServerRunLog
  | ServerRunFinished
  | ServerAgentStarted
  | ServerAgentStopped
  | ServerAgentTurnStarted
  | ServerAgentTurnFinished
  | ServerAgentItem
  | ServerAgentMessageDelta
  | ServerAgentError
  | ServerAgentApprovalRequest
  | ServerAgentApprovalResolved
  | ServerVerificationResult
  | ServerRunMetrics
  | ServerRunArtifacts
  | ServerAgentTokenUsage
  | ServerAgentTurnDiff
  | ServerAgentCompacted
  | ServerAgentPlanUpdated
  | ServerScaffoldProposed
  | ServerScaffoldResolved
  | ServerProfileChanged
  | ServerWireProposed
  | ServerWireResolved;

// ─── Browser → Server ──────────────────────────────────────────────────────

export interface ClientPong {
  type: "pong";
  t: number;
}

export interface ClientAgentApprovalResponse {
  type: "agent_approval_response";
  sessionId: string;
  requestId: number;
  decision: "accept" | "decline";
}

export type ClientMessage = ClientPong | ClientAgentApprovalResponse;

// ─── REST API request/response shapes ─────────────────────────────────────

export interface CreateSessionRequest {
  kind: SessionKind;
  title?: string;
  prompt?: string | null;
  repo?: string | null;
  repoPath?: string | null;
  taskRef?: string | null;
  /** Agent backend to use. Defaults to "codex" if unset. */
  backend?: AgentBackendName;
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

export interface CreateRunRequest {
  command: string | string[];
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
  logs?: RunLogEntry[];
}

export interface StartAgentRequest {
  sandbox?: Sandbox;
}

export interface StartAgentResponse {
  session: Session;
}

export interface RunScenarioRequest {
  /** Optional partial param overrides; missing keys fall back to sweep. */
  params?: Record<string, string | number>;
}

export interface RunScenarioResponse {
  runs: Run[];
  sweepId: string | null;
}

export interface AgentMessageRequest {
  prompt: string;
}

export interface AgentMessageResponse {
  turnId: string;
}

// ─── PRs ───────────────────────────────────────────────────────────────────

export interface PrDraftResponse {
  title: string;
  body: string;
  commitCount: number;
  filesChanged: string[];
  base: string;
}

export interface OpenPrRequest {
  title: string;
  body: string;
}

export interface OpenPrResponse {
  url: string;
  branch: string;
}
