/**
 * Agent-backend abstraction.
 *
 * Range was originally built tightly against Codex's `app-server`
 * JSON-RPC protocol — every route in server/index.ts called into
 * `codex.ts` directly. Adding a second backend (OpenCode, anthropic-
 * via-MCP, a hypothetical Claude Code shim, etc.) means routing all
 * agent operations through a single contract.
 *
 * The contract here is intentionally narrow: it covers what an
 * agent backend *must* expose to plug into Range's session model.
 * Things that aren't backend-specific (composing base instructions,
 * archiving the Range-owned events.jsonl, replaying history into
 * the UI) stay in their original modules — backends don't own them.
 *
 * Optional methods are marked optional (`?`). The features manifest
 * gives the UI a machine-checkable way to gate slash items: e.g.,
 * `/compact` is hidden when the active backend has
 * `features.compact === false`.
 *
 * Stateful per-session bookkeeping lives inside each backend — the
 * registry only chooses which one to dispatch to.
 */

import { log } from "./log.ts";
import { getSession } from "./sessions.ts";
import type { Sandbox } from "../shared/protocol.ts";

export type ApprovalDecision = "accept" | "decline";

export interface AgentBackendFeatures {
  /** `/compact` slash builtin works (backend can summarize the
   *  conversation in place). */
  compact: boolean;
  /** Resuming a persisted thread on next start preserves the
   *  conversation context (vs. starting fresh every time). */
  resume: boolean;
  /** Backend pushes live token-usage updates (vs. Range polling
   *  after each turn). Drives the worktree header token pill. */
  pushTokenUsage: boolean;
  /** Backend pushes live diff updates per turn (drives `/diff`
   *  and the conversation diff card). */
  pushTurnDiff: boolean;
  /** Backend emits a structured plan/todo event (drives the live
   *  plan checklist on each turn). */
  plans: boolean;
}

export interface AgentStartOptions {
  /** Optional sandbox override for this single start. Persists
   *  on the session if not provided. */
  sandbox?: Sandbox;
}

/**
 * A slash command the backend itself owns (vs. Range-managed
 * cross-backend ones like /model, /compact). Surfaced in Range's
 * slash picker with a backend-named badge. Picking one calls
 * `backend.runNativeCommand(sessionId, name, args)`.
 */
export interface BackendCommand {
  name: string;
  description: string;
  /** Display hint shown next to the command name, e.g. "<path>". */
  argHint?: string;
}

export interface BackendCommandResult {
  /** Optional message to display inline in the conversation as a
   *  system entry. Useful for commands whose effect isn't already
   *  visible elsewhere (e.g. /share returns a URL). */
  message?: string;
}

/**
 * Every agent backend implements this contract. Backends own
 * their own internal state (a Map keyed by sessionId is the usual
 * pattern). The registry holds one instance per backend kind.
 */
export interface AgentBackend {
  /** Stable identifier — matches the `backend` column on sessions. */
  readonly name: AgentBackendName;

  /** Capability manifest. Used by the UI to gate slash items and
   *  by Range to skip optional handler paths. */
  readonly features: AgentBackendFeatures;

  /** Start (or resume) the backend for this session. Idempotent —
   *  if the backend is already running, returns the existing
   *  threadId without re-spawning. */
  start(
    sessionId: string,
    options?: AgentStartOptions,
  ): Promise<{ threadId: string }>;

  /** Stop the backend for this session. Returns false if it
   *  wasn't running. */
  stop(sessionId: string): Promise<boolean>;

  /** Synchronous check: is the backend currently alive for this
   *  session? Used by routes that decide whether to restart on
   *  config change. */
  isRunning(sessionId: string): boolean;

  /** Send a user message. Lazy-starts the backend if it isn't
   *  already alive. Returns the backend's turn identifier. */
  sendMessage(
    sessionId: string,
    prompt: string,
  ): Promise<{ turnId: string }>;

  /** Respond to a pending approval request that the backend
   *  surfaced earlier. Returns false if the request was unknown
   *  (e.g., already timed out). */
  respondToApproval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ): boolean;

  /** Optional: compact / summarize the conversation in place.
   *  Backends without this capability must set
   *  `features.compact === false`. */
  compact?(sessionId: string): Promise<void>;

  /** Synchronous best-effort shutdown of every alive session.
   *  Called from SIGINT/SIGTERM. Backends should kill child
   *  processes here; the process is about to exit. */
  shutdownAll(): void;

  /** Slash commands the backend itself owns. Surfaced in Range's
   *  slash picker; selecting one calls runNativeCommand. Static
   *  per-backend — does not depend on session state. */
  nativeCommands: BackendCommand[];

  /** Execute a named native command on a session. Throws if the
   *  name isn't in `nativeCommands` or if the backend doesn't
   *  recognize it. */
  runNativeCommand?(
    sessionId: string,
    name: string,
    args: string,
  ): Promise<BackendCommandResult>;
}

export type AgentBackendName = "codex" | "opencode";

const DEFAULT_BACKEND: AgentBackendName = "codex";

/** Registry of every registered backend, keyed by `name`. */
const backends = new Map<AgentBackendName, AgentBackend>();

/** Backends register themselves once at module load. Order
 *  doesn't matter — selection is by name. */
export function registerBackend(backend: AgentBackend): void {
  if (backends.has(backend.name)) {
    log.warn("agent", "backend already registered, overwriting", {
      name: backend.name,
    });
  }
  backends.set(backend.name, backend);
  log.info("agent", "backend registered", {
    name: backend.name,
    features: backend.features,
  });
}

/** Resolve the backend for a given session, falling back to the
 *  default if the session row's `backend` column is unset or
 *  unrecognized. Throws if the default backend isn't registered
 *  (which would be a server-config bug). */
export function backendFor(sessionId: string): AgentBackend {
  const session = getSession(sessionId);
  const want = (session?.backend as AgentBackendName | null) ?? DEFAULT_BACKEND;
  const found = backends.get(want);
  if (found) return found;
  // Session asked for a backend that isn't registered. Fall back.
  log.warn("agent", "requested backend not registered, falling back", {
    requested: want,
    fallback: DEFAULT_BACKEND,
  });
  const fallback = backends.get(DEFAULT_BACKEND);
  if (!fallback) {
    throw new Error(
      `no agent backends registered (default '${DEFAULT_BACKEND}' missing)`,
    );
  }
  return fallback;
}

/** Iterate every registered backend's `shutdownAll`. Used by
 *  the SIGINT/SIGTERM handler so we don't leak child processes
 *  on server exit. */
export function shutdownAllBackends(): void {
  for (const b of backends.values()) {
    try {
      b.shutdownAll();
    } catch (err) {
      log.warn("agent", "backend shutdownAll failed", {
        name: b.name,
        err: String(err instanceof Error ? err.message : err),
      });
    }
  }
}

/** List every backend currently registered. Used by the UI to
 *  build the backend selector. */
export function listBackends(): Array<{
  name: AgentBackendName;
  features: AgentBackendFeatures;
}> {
  return [...backends.values()].map((b) => ({
    name: b.name,
    features: b.features,
  }));
}
