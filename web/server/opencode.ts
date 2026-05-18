/**
 * OpenCode adapter — implements AgentBackend against the
 * opencode HTTP+SSE server.
 *
 * Architecture: one shared `opencode serve` process for the whole
 * Range server. Each Range session maps to one OpenCode session
 * (identified by `ses_…`). OpenCode runs sessions in its own
 * persistence layer, so "resume across teardown" comes free —
 * we just remember the OpenCode session id on the Range row.
 *
 * Wire mapping (Range internal event → OpenCode SSE event):
 *
 *   agent_started               session creation
 *   agent_turn_started          prompt_async ack (synthesized)
 *   agent_turn_finished         session.idle / session.status
 *   agent_item (message)        message.part.updated (TextPart)
 *   agent_item (reasoning)      message.part.updated (ReasoningPart)
 *   agent_item (command)        message.part.updated (ToolPart)
 *   agent_item (file_edit)      message.part.updated (FilePart/PatchPart)
 *   agent_message_delta         message.part.delta (direct map)
 *   agent_plan_updated          todo.updated (normalize statuses)
 *   agent_turn_diff             session.diff
 *   agent_approval_request      permission.asked
 *   agent_compacted             CompactionPart on message.part.updated
 *
 * Sandbox modes are translated into PATCH /session/:id with a
 * permission ruleset.
 */

import type { Subprocess } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { log } from "./log.ts";
import { broadcast } from "./hub.ts";
import {
  getSession,
  setSessionCodexThreadId,
} from "./sessions.ts";
import type {
  AgentItem,
  AgentItemKind,
  PlanStep,
  Sandbox,
  ServerMessage,
} from "../shared/protocol.ts";
import { registerBackend, type AgentBackend } from "./agent.ts";

// ─── Shared-server lifecycle ──────────────────────────────────────────────

interface SharedServer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proc: Subprocess<"ignore", "ignore", any>;
  baseUrl: string;
  password: string;
  /** Started, JSON-RPC has been handshaken, /event is subscribed. */
  ready: Promise<void>;
}

let sharedServer: SharedServer | null = null;
let sharedServerStarting: Promise<SharedServer | null> | null = null;

const SERVER_PORT_BASE = 4096;

function pickPort(): number {
  // Random per-launch port so we don't collide with a user-run opencode.
  return SERVER_PORT_BASE + Math.floor(Math.random() * 1000);
}

function envelopeAuth(password: string): { Authorization: string } {
  return {
    Authorization:
      "Basic " + Buffer.from(`opencode:${password}`).toString("base64"),
  };
}

async function startSharedServer(): Promise<SharedServer> {
  if (sharedServer) return sharedServer;
  if (sharedServerStarting) {
    const s = await sharedServerStarting;
    if (!s) throw new Error("opencode server failed to start");
    return s;
  }

  sharedServerStarting = (async () => {
    const password = randomBytes(16).toString("hex");
    const port = pickPort();

    log.info("opencode", "spawning shared server", { port });
    // Write opencode's logs to a Range-managed file so we can
    // inspect them when something goes wrong without blocking the
    // child on a full pipe.
    const logPath = join(homedir(), ".range", "opencode-serve.log");
    const proc = Bun.spawn(
      [
        "opencode",
        "serve",
        "--port",
        String(port),
        "--hostname",
        "127.0.0.1",
        "--log-level",
        "INFO",
        "--print-logs",
      ],
      {
        stdin: "ignore",
        stdout: "ignore",
        stderr: Bun.file(logPath),
        env: {
          ...(process.env as Record<string, string>),
          OPENCODE_SERVER_PASSWORD: password,
        },
      },
    );

    const baseUrl = `http://127.0.0.1:${port}`;

    // Poll the health-ish endpoint until ready (or timeout). Each
    // probe is bounded by AbortSignal — opencode's /doc returns a
    // large OpenAPI document and we've seen the fetch hang when the
    // body is streamed slowly. We only care about the status code,
    // so 500ms per probe is generous.
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      try {
        const r = await fetch(`${baseUrl}/doc`, {
          headers: envelopeAuth(password),
          signal: AbortSignal.timeout(500),
        });
        // Drain quickly so the connection closes.
        await r.text().catch(() => undefined);
        if (r.ok) ok = true;
      } catch {
        // not up yet OR timed out — retry
      }
      if (!ok) await new Promise((r) => setTimeout(r, 200));
    }
    if (!ok) {
      try {
        proc.kill();
      } catch {
        // already dead
      }
      throw new Error("opencode serve did not become ready within 6s");
    }
    log.info("opencode", "shared server ready", { baseUrl });

    const ready = Promise.resolve();
    sharedServer = { proc, baseUrl, password, ready };

    // SSE is workspace-scoped — each session needs its own
    // subscription with ?directory=<workspace>. Subscriptions are
    // opened in ensureSession, not here.
    return sharedServer;
  })();

  try {
    const s = await sharedServerStarting;
    if (!s) throw new Error("opencode server failed to start");
    return s;
  } finally {
    sharedServerStarting = null;
  }
}

async function getServer(): Promise<SharedServer> {
  return sharedServer ?? (await startSharedServer());
}

async function apiGet<T>(path: string): Promise<T> {
  const s = await getServer();
  const r = await fetch(`${s.baseUrl}${path}`, {
    headers: envelopeAuth(s.password),
  });
  if (!r.ok) {
    throw new Error(`GET ${path} → HTTP ${r.status}: ${await r.text()}`);
  }
  return (await r.json()) as T;
}

async function apiPost<T>(
  path: string,
  body: unknown = {},
): Promise<T | null> {
  const s = await getServer();
  const r = await fetch(`${s.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...envelopeAuth(s.password),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`POST ${path} → HTTP ${r.status}: ${await r.text()}`);
  }
  if (r.status === 204) return null;
  const text = await r.text();
  if (text.length === 0) return null;
  return JSON.parse(text) as T;
}

async function apiPatch<T>(
  path: string,
  body: unknown = {},
): Promise<T | null> {
  const s = await getServer();
  const r = await fetch(`${s.baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...envelopeAuth(s.password),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`PATCH ${path} → HTTP ${r.status}: ${await r.text()}`);
  }
  if (r.status === 204) return null;
  const text = await r.text();
  if (text.length === 0) return null;
  return JSON.parse(text) as T;
}

// apiDelete intentionally unused right now — we keep OpenCode
// sessions persisted on stop so users can return to history. Add
// back when we need it.

// ─── Per-Range-session state ──────────────────────────────────────────────

interface OpenCodeSessionState {
  /** Range's session id (key into the sessions Map). */
  rangeSessionId: string;
  /** OpenCode's `ses_…` id. Same value lives on the Range row as
   *  `codexThreadId` (the column is poorly named — it stores any
   *  backend's persistent thread id). */
  openCodeSessionId: string;
  /** The OpenCode workspace (directory) this session was created
   *  in. Required as the `?directory=` query on every API call so
   *  workspace routing finds the right state. */
  workspace: string;
  /** When the last SSE event for this session was received. Drives
   *  the idle-shutdown sweeper. */
  lastActivityAt: number;
  /** OpenCode's permission requests keyed by permissionID, for
   *  approval correlation. We rewrite ids to numbers for Range's
   *  internal protocol, mapping back here. */
  permissionIdByNumeric: Map<number, string>;
  /** Counter for numeric ids we hand out to Range. */
  nextNumericPermId: number;
  /** AbortController for this session's SSE subscription so we
   *  can shut it down on stop/shutdown. */
  sseAbort: AbortController;
}

const sessions = new Map<string, OpenCodeSessionState>();

/** Lookup the Range session record matching an OpenCode sessionID
 *  (reverse index). Used by SSE dispatch. */
function findRangeSessionByOpenCodeId(
  openCodeSessionId: string,
): OpenCodeSessionState | null {
  for (const s of sessions.values()) {
    if (s.openCodeSessionId === openCodeSessionId) return s;
  }
  return null;
}

function touchActivity(state: OpenCodeSessionState): void {
  state.lastActivityAt = Date.now();
}

// ─── Configuration translation ────────────────────────────────────────────

/**
 * Codex has 3 sandbox modes baked in; OpenCode uses a fine-grained
 * permission ruleset (array of `{permission, pattern, action}`).
 * Translate one to the other so the Range UI's sandbox switcher
 * does something meaningful on OpenCode sessions.
 *
 * The mapping is intentionally coarse — pattern `*` matches every
 * tool invocation:
 *   read-only          → ask for everything
 *   workspace-write    → allow edits/writes, ask for the rest
 *   danger-full-access → allow everything
 */
type PermAction = "allow" | "ask" | "deny";
type PermRule = { permission: string; pattern: string; action: PermAction };

function rulesetForSandbox(sandbox: Sandbox): { permission: PermRule[] } {
  const rule = (permission: string, action: PermAction): PermRule => ({
    permission,
    pattern: "*",
    action,
  });
  if (sandbox === "danger-full-access") {
    return {
      permission: [
        rule("edit", "allow"),
        rule("write", "allow"),
        rule("bash", "allow"),
        rule("webfetch", "allow"),
      ],
    };
  }
  if (sandbox === "workspace-write") {
    return {
      permission: [
        rule("edit", "allow"),
        rule("write", "allow"),
        rule("bash", "ask"),
        rule("webfetch", "ask"),
      ],
    };
  }
  // read-only
  return {
    permission: [
      rule("edit", "ask"),
      rule("write", "ask"),
      rule("bash", "ask"),
      rule("webfetch", "ask"),
    ],
  };
}

/**
 * Pick a default (providerID, modelID). Override via env:
 *
 *   RANGE_OPENCODE_PROVIDER=nvidia-inference-gateway
 *   RANGE_OPENCODE_MODEL=openai/openai/gpt-5.5
 *
 * Otherwise: walk `/config/providers` and pick the first
 * provider/model pair. Throws if nothing is configured.
 *
 * (Long-term, this should be a per-session knob threaded through
 * Range's `model` column instead of a global default. Today the
 * column is a single string — fine for Codex, ambiguous for
 * OpenCode's `{providerID, modelID}` shape. Defer the schema
 * cleanup until we have a real signal.)
 */
async function defaultModel(): Promise<{
  providerID: string;
  modelID: string;
}> {
  const envProvider = process.env.RANGE_OPENCODE_PROVIDER;
  const envModel = process.env.RANGE_OPENCODE_MODEL;
  if (envProvider && envModel) {
    return { providerID: envProvider, modelID: envModel };
  }
  type ConfigProvidersResponse = {
    providers: {
      id: string;
      models: Record<string, { id: string }>;
    }[];
  };
  const cfg = await apiGet<ConfigProvidersResponse>("/config/providers");
  for (const p of cfg.providers ?? []) {
    const firstModel = Object.keys(p.models ?? {})[0];
    if (firstModel) return { providerID: p.id, modelID: firstModel };
  }
  throw new Error(
    "no providers configured in OpenCode — run `opencode auth login` first",
  );
}

// ─── Event translation (SSE → Range internal) ─────────────────────────────

/** Emit a Range internal event for a session. Mirrors codex.ts:emit. */
function emit(msg: ServerMessage): void {
  broadcast(msg);
}

/**
 * Subscribe to an SSE event stream for a single workspace (the
 * session's `directory`). OpenCode's bus is workspace-scoped — a
 * single global subscription only sees events from one workspace,
 * so we open one stream per Range session.
 */
async function consumeSseEvents(
  workspace: string,
  abort: AbortController,
): Promise<void> {
  const s = await getServer();
  const url = `${s.baseUrl}/event?directory=${encodeURIComponent(workspace)}`;
  const res = await fetch(url, {
    headers: envelopeAuth(s.password),
    signal: abort.signal,
  });
  if (!res.body) {
    throw new Error("opencode /event returned no body");
  }
  log.info("opencode", "SSE connected", { workspace });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    let chunk: { done: boolean; value?: Uint8Array };
    try {
      chunk = await reader.read();
    } catch {
      break; // aborted
    }
    if (chunk.done || !chunk.value) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0) continue;
        try {
          const ev = JSON.parse(payload);
          handleEvent(ev);
        } catch (err) {
          log.warn("opencode", "SSE parse failed", {
            err: String(err),
            line: payload.slice(0, 120),
          });
        }
      }
    }
  }
  log.info("opencode", "SSE stream ended", { workspace });
}

function handleEvent(envelope: Record<string, unknown>): void {
  const type = typeof envelope.type === "string" ? envelope.type : "";
  if (!type) return;

  // OpenCode's SSE envelopes wrap event-specific data inside a
  // `properties` object: `{ id, type, properties: { sessionID, ... } }`.
  // Unwrap so each handler reads payload fields directly.
  const ev =
    typeof envelope.properties === "object" && envelope.properties !== null
      ? (envelope.properties as Record<string, unknown>)
      : envelope;

  const openCodeSessionId =
    typeof ev.sessionID === "string" ? ev.sessionID : "";

  const state = openCodeSessionId
    ? findRangeSessionByOpenCodeId(openCodeSessionId)
    : null;
  if (state) touchActivity(state);

  switch (type) {
    case "server.connected":
      log.info("opencode", "SSE connected");
      return;

    case "session.idle":
    case "session.status": {
      if (!state) return;
      const status =
        type === "session.idle"
          ? "idle"
          : (ev as { status?: { type?: string } }).status?.type ?? "idle";
      if (status === "idle") {
        emit({
          type: "agent_turn_finished",
          sessionId: state.rangeSessionId,
          turnId: state.openCodeSessionId, // OpenCode doesn't expose turnIds explicitly
          status: "ok",
        });
      }
      return;
    }

    case "session.error": {
      if (!state) return;
      const errMessage =
        typeof (ev as { responseBody?: unknown }).responseBody === "string"
          ? (ev as { responseBody: string }).responseBody
          : typeof (ev as { error?: { message?: unknown } }).error?.message ===
              "string"
            ? ((ev as { error: { message: string } }).error.message as string)
            : "unknown error";
      emit({
        type: "agent_error",
        sessionId: state.rangeSessionId,
        message: errMessage,
      });
      emit({
        type: "agent_turn_finished",
        sessionId: state.rangeSessionId,
        turnId: state.openCodeSessionId,
        status: "failed",
      });
      return;
    }

    case "session.diff": {
      if (!state) return;
      const diff = (ev as { diff?: unknown[] }).diff;
      // OpenCode's diff is an array of file diffs; render as a
      // human-readable summary for now (matches `/diff`'s format).
      const text = Array.isArray(diff)
        ? `${diff.length} file(s) changed`
        : "";
      emit({
        type: "agent_turn_diff",
        sessionId: state.rangeSessionId,
        threadId: state.openCodeSessionId,
        turnId: state.openCodeSessionId,
        diff: text,
      });
      return;
    }

    case "message.part.delta": {
      if (!state) return;
      const partID = (ev as { partID?: string }).partID;
      const delta = (ev as { delta?: string }).delta;
      const field = (ev as { field?: string }).field;
      if (!partID || typeof delta !== "string") return;
      // Only forward text/reasoning deltas to the message_delta path;
      // other fields just bump activity.
      if (field === "text" || field === "reasoning") {
        emit({
          type: "agent_message_delta",
          sessionId: state.rangeSessionId,
          itemId: partID,
          delta,
        });
      }
      return;
    }

    case "message.part.updated": {
      if (!state) return;
      const part = (ev as { part?: Record<string, unknown> }).part;
      if (!part) return;
      const item = partToAgentItem(part);
      if (!item) return;
      emit({
        type: "agent_item",
        sessionId: state.rangeSessionId,
        item,
      });
      return;
    }

    case "todo.updated": {
      if (!state) return;
      const todos = Array.isArray((ev as { todos?: unknown[] }).todos)
        ? ((ev as { todos: unknown[] }).todos as Array<{
            content?: string;
            status?: string;
          }>)
        : [];
      const plan: PlanStep[] = todos
        .map((t) => {
          if (typeof t.content !== "string") return null;
          const raw = typeof t.status === "string" ? t.status : "pending";
          const status: PlanStep["status"] =
            raw === "in_progress" || raw === "inProgress"
              ? "in_progress"
              : raw === "completed" || raw === "cancelled"
                ? "completed"
                : "pending";
          return { step: t.content, status };
        })
        .filter((x): x is PlanStep => x !== null);
      emit({
        type: "agent_plan_updated",
        sessionId: state.rangeSessionId,
        threadId: state.openCodeSessionId,
        turnId: state.openCodeSessionId,
        plan,
        explanation: null,
      });
      return;
    }

    case "permission.asked": {
      if (!state) return;
      const id = (ev as { id?: string }).id;
      const permission = (ev as { permission?: string }).permission;
      const patterns = (ev as { patterns?: string[] }).patterns ?? [];
      const metadata =
        ((ev as { metadata?: Record<string, unknown> }).metadata as Record<
          string,
          unknown
        >) ?? {};
      if (!id) return;
      const numericId = state.nextNumericPermId++;
      state.permissionIdByNumeric.set(numericId, id);
      // Build a Range approval payload that the UI already knows how
      // to render. ApprovalRequest's payload schema has cwd, command,
      // description, etc. — we map best-effort.
      const command =
        typeof metadata.command === "string"
          ? (metadata.command as string)
          : Array.isArray(metadata.command)
            ? (metadata.command as string[]).join(" ")
            : `${permission}: ${patterns.join(", ")}`;
      emit({
        type: "agent_approval_request",
        sessionId: state.rangeSessionId,
        requestId: numericId,
        kind: "command",
        payload: {
          command,
          description: permission,
          cwd:
            typeof metadata.cwd === "string"
              ? (metadata.cwd as string)
              : undefined,
        },
      });
      return;
    }

    case "permission.replied":
      // We already emitted agent_approval_resolved when we POSTed
      // the reply ourselves; OpenCode echoes back the same fact.
      // Could double-fire, but the store dedupes by requestId.
      return;
  }
}

/**
 * Translate an OpenCode message Part into a Range AgentItem. Range's
 * AgentItem union has a fixed set of `kind` values: returns null for
 * parts that don't map (StepStart/Finish, Snapshot, etc. are
 * informational, not surfaced to the user).
 */
function partToAgentItem(
  part: Record<string, unknown>,
): AgentItem | null {
  const type = part.type as string | undefined;
  const id = part.id as string | undefined;
  if (!id) return null;
  const baseState = part.time && (part.time as { end?: number }).end
    ? "completed"
    : "started";
  switch (type) {
    case "text":
      return {
        id,
        kind: "message",
        state: baseState,
        text: (part.text as string | undefined) ?? "",
      };
    case "reasoning":
      return {
        id,
        kind: "reasoning",
        state: baseState,
        text: (part.text as string | undefined) ?? "",
      };
    case "tool": {
      const tool =
        typeof part.tool === "string" ? (part.tool as string) : "tool";
      const stateObj = part.state as
        | { input?: unknown; output?: unknown; status?: string }
        | undefined;
      const text =
        typeof stateObj?.output === "string"
          ? (stateObj.output as string)
          : "";
      // Map common tool names to Range item kinds.
      const kind: AgentItemKind =
        tool === "bash" || tool === "shell"
          ? "command"
          : tool === "edit" || tool === "write" || tool === "patch"
            ? "file_edit"
            : "mcp_tool";
      if (kind === "command") {
        const input = (stateObj?.input ?? {}) as {
          command?: string | string[];
          cwd?: string;
        };
        return {
          id,
          kind: "command",
          state: baseState,
          command: input.command ?? tool,
          cwd: input.cwd,
          output: text,
        };
      }
      if (kind === "file_edit") {
        const input = (stateObj?.input ?? {}) as {
          path?: string;
          file_path?: string;
        };
        const changeKind: "edit" | "create" | "delete" | "modify" =
          tool === "write" ? "create" : tool === "patch" ? "modify" : "edit";
        return {
          id,
          kind: "file_edit",
          state: baseState,
          path: input.path ?? input.file_path ?? "(unknown)",
          changeKind,
          summary: text || undefined,
        };
      }
      return {
        id,
        kind: "mcp_tool",
        state: baseState,
        tool,
        output: text,
      };
    }
    default:
      return null;
  }
}

// ─── AgentBackend implementation ──────────────────────────────────────────

const IDLE_SHUTDOWN_MS = 20 * 60 * 1000;

async function ensureSession(
  rangeSessionId: string,
  sandbox: Sandbox,
): Promise<OpenCodeSessionState> {
  let state = sessions.get(rangeSessionId);
  if (state) return state;

  const session = getSession(rangeSessionId);
  if (!session) throw new Error(`session not found: ${rangeSessionId}`);

  // Reuse if we have a persisted OpenCode session id from a prior run.
  // The column is named `codexThreadId` but stores any backend's id.
  let openCodeSessionId = session.codexThreadId ?? "";

  const cwd = session.worktreePath ?? session.repoPath ?? homedir();
  await getServer(); // ensure server is up

  if (!openCodeSessionId) {
    type CreateResp = { id: string };
    const created = await apiPost<CreateResp>(
      `/session?directory=${encodeURIComponent(cwd)}`,
      {},
    );
    if (!created?.id) {
      throw new Error("opencode session creation returned no id");
    }
    openCodeSessionId = created.id;
    setSessionCodexThreadId(rangeSessionId, openCodeSessionId);
    log.info("opencode", "session created", {
      rangeSessionId,
      openCodeSessionId,
      cwd,
    });
  } else {
    log.info("opencode", "reusing session", {
      rangeSessionId,
      openCodeSessionId,
    });
  }

  // Apply permission ruleset for the current sandbox.
  try {
    await apiPatch(
      `/session/${openCodeSessionId}?directory=${encodeURIComponent(cwd)}`,
      rulesetForSandbox(sandbox),
    );
  } catch (err) {
    log.warn("opencode", "permission update failed (continuing)", {
      err: String(err instanceof Error ? err.message : err),
    });
  }

  const sseAbort = new AbortController();
  state = {
    rangeSessionId,
    openCodeSessionId,
    workspace: cwd,
    lastActivityAt: Date.now(),
    permissionIdByNumeric: new Map(),
    nextNumericPermId: 1,
    sseAbort,
  };
  sessions.set(rangeSessionId, state);
  ensureIdleSweeper();

  // Open the SSE subscription for this session's workspace.
  void consumeSseEvents(cwd, sseAbort).catch((err) => {
    if (!sseAbort.signal.aborted) {
      log.warn("opencode", "SSE consumer crashed", {
        rangeSessionId,
        err: String(err instanceof Error ? err.message : err),
      });
    }
  });

  emit({
    type: "agent_started",
    sessionId: rangeSessionId,
    threadId: openCodeSessionId,
  });
  return state;
}

let idleSweeper: ReturnType<typeof setInterval> | null = null;
function ensureIdleSweeper(): void {
  if (idleSweeper) return;
  idleSweeper = setInterval(() => {
    const now = Date.now();
    for (const [rangeSessionId, st] of sessions) {
      if (now - st.lastActivityAt < IDLE_SHUTDOWN_MS) continue;
      log.info("opencode", "idle shutdown", {
        rangeSessionId,
        idleMs: now - st.lastActivityAt,
      });
      // Just drop the local state; OpenCode keeps the session
      // persisted server-side and we'll reattach to the same
      // session id on next send.
      sessions.delete(rangeSessionId);
      emit({
        type: "agent_stopped",
        sessionId: rangeSessionId,
        reason: `idle ${Math.floor((now - st.lastActivityAt) / 1000)}s`,
      });
    }
  }, 60 * 1000);
}

export const openCodeBackend: AgentBackend = {
  name: "opencode",
  features: {
    compact: true,         // POST /session/:id/summarize
    resume: true,          // OpenCode persists sessions natively
    pushTokenUsage: false, // No push event; on session.updated only
    pushTurnDiff: true,    // session.diff
    plans: true,           // todo.updated
  },

  async start(rangeSessionId, options) {
    const session = getSession(rangeSessionId);
    if (!session) throw new Error(`session not found: ${rangeSessionId}`);
    const sandbox = options?.sandbox ?? session.sandbox;
    const state = await ensureSession(rangeSessionId, sandbox);
    return { threadId: state.openCodeSessionId };
  },

  async stop(rangeSessionId) {
    const state = sessions.get(rangeSessionId);
    if (!state) return false;
    state.sseAbort.abort();
    sessions.delete(rangeSessionId);
    emit({
      type: "agent_stopped",
      sessionId: rangeSessionId,
      reason: "stopped by user",
    });
    // We deliberately don't DELETE the OpenCode session — the
    // user's conversation history stays available for next time.
    return true;
  },

  isRunning(rangeSessionId) {
    return sessions.has(rangeSessionId);
  },

  async sendMessage(rangeSessionId, prompt) {
    const session = getSession(rangeSessionId);
    if (!session) throw new Error(`session not found: ${rangeSessionId}`);
    const state = await ensureSession(rangeSessionId, session.sandbox);
    touchActivity(state);

    // Synthesize a turn id since OpenCode doesn't expose one per
    // prompt. We use a fresh UUID; downstream events on the SSE
    // pipe will fire `agent_turn_finished` keyed on session.idle.
    const turnId = randomUUID();
    emit({
      type: "agent_turn_started",
      sessionId: rangeSessionId,
      turnId,
      prompt,
    });

    const model = await defaultModel();
    const cwd = session.worktreePath ?? session.repoPath ?? homedir();
    log.info("opencode", "prompt_async outgoing", {
      sessionId: state.openCodeSessionId,
      model,
      cwd,
      promptHead: prompt.slice(0, 60),
    });
    try {
      const resp = await apiPost(
        `/session/${state.openCodeSessionId}/prompt_async?directory=${encodeURIComponent(
          cwd,
        )}`,
        {
          model,
          parts: [{ type: "text", text: prompt }],
        },
      );
      log.info("opencode", "prompt_async accepted", {
        sessionId: state.openCodeSessionId,
        resp: resp ?? null,
      });
    } catch (err) {
      log.error("opencode", "prompt_async failed", {
        err: String(err instanceof Error ? err.message : err),
      });
      emit({
        type: "agent_error",
        sessionId: rangeSessionId,
        message: String(err instanceof Error ? err.message : err),
      });
      emit({
        type: "agent_turn_finished",
        sessionId: rangeSessionId,
        turnId,
        status: "failed",
      });
    }
    return { turnId };
  },

  respondToApproval(rangeSessionId, requestId, decision) {
    const state = sessions.get(rangeSessionId);
    if (!state) return false;
    const permissionId = state.permissionIdByNumeric.get(requestId);
    if (!permissionId) return false;
    state.permissionIdByNumeric.delete(requestId);

    const response: "once" | "reject" =
      decision === "accept" ? "once" : "reject";
    // Fire-and-forget. We emit the resolved event optimistically.
    void apiPost(
      `/session/${state.openCodeSessionId}/permissions/${permissionId}`,
      { response },
    ).catch((err) => {
      log.warn("opencode", "permission reply failed", {
        err: String(err instanceof Error ? err.message : err),
      });
    });
    emit({
      type: "agent_approval_resolved",
      sessionId: rangeSessionId,
      requestId,
      decision,
    });
    return true;
  },

  async compact(rangeSessionId) {
    const state = sessions.get(rangeSessionId);
    if (!state) throw new Error(`opencode session not running: ${rangeSessionId}`);
    // OpenCode's summarize endpoint requires a model — it runs an
    // LLM pass to summarize the prior conversation. Use whichever
    // model the rest of the session is using.
    const model = await defaultModel();
    await apiPost(
      `/session/${state.openCodeSessionId}/summarize?directory=${encodeURIComponent(state.workspace)}`,
      { providerID: model.providerID, modelID: model.modelID },
    );
  },

  shutdownAll() {
    // Drop all per-session state and kill the shared server.
    for (const st of sessions.values()) {
      try {
        st.sseAbort.abort();
      } catch {
        // already aborted
      }
    }
    sessions.clear();
    if (sharedServer) {
      try {
        sharedServer.proc.kill("SIGKILL");
      } catch {
        // already dead
      }
      sharedServer = null;
    }
  },
};

registerBackend(openCodeBackend);

// Used in dev for debugging.
export { sessions as _sessions, getServer as _getServer };
