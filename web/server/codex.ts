/**
 * Codex adapter.
 *
 * Spawns `codex app-server` as a subprocess per attempt and talks
 * JSON-RPC 2.0 newline-delimited over stdio. Translates Codex's item
 * lifecycle (item/started → optional item/updated → item/completed,
 * plus item/agentMessage/delta for streaming text) into Range-native
 * `agent_*` WebSocket events.
 *
 * MVP scope (Phase A):
 *   - initialize / initialized / thread/start handshake
 *   - approvalPolicy: "never", sandbox: "read-only"
 *   - turn/start with a prompt
 *   - notification translation for agentMessage, reasoning, commandExecution
 *   - persist all observed items to ~/.range/threads/<attempt_id>/events.jsonl
 *
 * Out of scope (Phase B+):
 *   - Approval request flow (requires "untrusted" or "on-request" policy)
 *   - File-edit items (require workspace-write sandbox)
 *   - MCP tool / web search item kinds (passed through as 'unknown')
 *   - thread/resume across server restarts
 *   - Multi-model selection (uses the user's ~/.codex/config.toml default)
 */

import type { Subprocess } from "bun";
import { mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./log.ts";
import { broadcast } from "./hub.ts";
import { getAttempt, setCodexThreadId } from "./attempts.ts";
import type {
  AgentItem,
  AgentItemState,
  ServerMessage,
} from "../shared/protocol.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

type Pending = {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
};

interface CodexSession {
  attemptId: string;
  proc: Subprocess<"pipe", "pipe", "pipe">;
  nextRequestId: number;
  pendingRequests: Map<number, Pending>;
  threadId: string | null;
  /** Codex item.id → cached state we've accumulated (text for streaming) */
  itemTexts: Map<string, string>;
  /** Codex item.id → last known kind/state to keep handlers consistent */
  itemMeta: Map<string, { kind: string }>;
  eventFile: WriteStream;
}

const sessions = new Map<string, CodexSession>();

// ─── Public API ────────────────────────────────────────────────────────────

function threadDir(attemptId: string): string {
  return join(homedir(), ".range", "threads", attemptId);
}

export function isAgentRunning(attemptId: string): boolean {
  return sessions.has(attemptId);
}

export async function startAgent(attemptId: string): Promise<{
  threadId: string;
}> {
  if (sessions.has(attemptId)) {
    const s = sessions.get(attemptId)!;
    return { threadId: s.threadId ?? "" };
  }

  const attempt = getAttempt(attemptId);
  if (!attempt) throw new Error(`attempt not found: ${attemptId}`);
  if (!attempt.worktreePath) {
    throw new Error(
      `attempt ${attemptId} has no worktree — attach a repo to the session before starting Codex`,
    );
  }

  const dir = threadDir(attemptId);
  await mkdir(dir, { recursive: true });
  const eventFile = createWriteStream(join(dir, "events.jsonl"), {
    flags: "a",
  });

  log.info("codex", "spawning", { attemptId, cwd: attempt.worktreePath });
  let proc: Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["codex", "app-server"], {
      cwd: attempt.worktreePath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    eventFile.end();
    throw new Error(`failed to spawn codex app-server: ${err}`);
  }

  const session: CodexSession = {
    attemptId,
    proc,
    nextRequestId: 1,
    pendingRequests: new Map(),
    threadId: null,
    itemTexts: new Map(),
    itemMeta: new Map(),
    eventFile,
  };
  sessions.set(attemptId, session);

  // Start reading stdout in the background.
  void readLoop(session).catch((err) => {
    log.error("codex", "read loop crashed", {
      attemptId,
      err: String(err),
    });
    teardown(session, `read loop crashed: ${err}`);
  });

  // Tee stderr to logs (best effort).
  void teeStderr(session).catch(() => undefined);

  // Notify the browser that Codex is starting (before handshake completes,
  // so the UI can show a spinner).
  emit({
    type: "agent_started",
    attemptId,
    threadId: "<initializing>",
  });

  try {
    // Initialize handshake
    await sendRequest(session, "initialize", {
      clientInfo: { name: "range", version: "0.1.0" },
      capabilities: {},
    });
    sendNotification(session, "initialized", {});

    // Start a new thread.
    const threadResp = (await sendRequest(session, "thread/start", {
      cwd: attempt.worktreePath,
      approvalPolicy: "never",
      sandbox: "read-only",
    })) as { thread?: { id?: string }; threadId?: string };

    const threadId =
      threadResp?.thread?.id ?? threadResp?.threadId ?? "";
    if (!threadId) {
      throw new Error("thread/start returned no thread id");
    }
    session.threadId = threadId;
    setCodexThreadId(attemptId, threadId);

    log.info("codex", "thread started", { attemptId, threadId });
    emit({ type: "agent_started", attemptId, threadId });

    return { threadId };
  } catch (err) {
    log.error("codex", "handshake failed", {
      attemptId,
      err: String(err),
    });
    teardown(session, `handshake failed: ${err}`);
    throw err;
  }
}

export async function sendUserMessage(
  attemptId: string,
  prompt: string,
): Promise<{ turnId: string }> {
  const session = sessions.get(attemptId);
  if (!session || !session.threadId) {
    throw new Error(`no live Codex session for attempt ${attemptId}`);
  }

  const resp = (await sendRequest(session, "turn/start", {
    threadId: session.threadId,
    input: [{ type: "text", text: prompt }],
  })) as { turn?: { id?: string }; turnId?: string };

  const turnId = resp?.turn?.id ?? resp?.turnId ?? "";
  emit({
    type: "agent_turn_started",
    attemptId,
    turnId,
    prompt,
  });
  return { turnId };
}

export async function stopAgent(attemptId: string): Promise<boolean> {
  const session = sessions.get(attemptId);
  if (!session) return false;
  teardown(session, "stopped by user");
  return true;
}

// ─── JSON-RPC plumbing ─────────────────────────────────────────────────────

function sendRaw(session: CodexSession, payload: unknown): void {
  try {
    session.proc.stdin.write(JSON.stringify(payload) + "\n");
  } catch (err) {
    log.error("codex", "stdin write failed", {
      attemptId: session.attemptId,
      err: String(err),
    });
  }
}

function sendNotification(
  session: CodexSession,
  method: string,
  params: Record<string, unknown>,
): void {
  sendRaw(session, { method, params });
}

function sendRequest(
  session: CodexSession,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<unknown> {
  const id = session.nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pendingRequests.delete(id);
      reject(new Error(`Codex request ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    session.pendingRequests.set(id, {
      resolve: (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    sendRaw(session, { method, id, params });
  });
}

async function readLoop(session: CodexSession): Promise<void> {
  const reader = session.proc.stdout;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of reader as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        const msg = JSON.parse(line);
        handleMessage(session, msg);
      } catch (err) {
        log.warn("codex", "non-JSON line", {
          attemptId: session.attemptId,
          err: String(err),
          line: line.slice(0, 200),
        });
      }
    }
  }
  // Process stdout closed → process exited.
  const exitCode = await session.proc.exited;
  log.info("codex", "process exited", {
    attemptId: session.attemptId,
    exitCode,
  });
  teardown(session, `exited code=${exitCode}`);
}

async function teeStderr(session: CodexSession): Promise<void> {
  const reader = session.proc.stderr;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of reader as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length === 0) continue;
      log.warn("codex.stderr", line, { attemptId: session.attemptId });
    }
  }
}

// ─── Message dispatch ──────────────────────────────────────────────────────

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcRequest extends JsonRpcNotification {
  id: number;
}

function handleMessage(session: CodexSession, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;

  if (typeof m.id === "number" && ("result" in m || "error" in m)) {
    handleResponse(session, m as unknown as JsonRpcResponse);
    return;
  }
  if (typeof m.method === "string" && typeof m.id === "number") {
    handleIncomingRequest(session, m as unknown as JsonRpcRequest);
    return;
  }
  if (typeof m.method === "string") {
    handleNotification(session, m as unknown as JsonRpcNotification);
    return;
  }
}

function handleResponse(
  session: CodexSession,
  msg: JsonRpcResponse,
): void {
  const pending = session.pendingRequests.get(msg.id);
  if (!pending) {
    log.warn("codex", "response with no pending request", {
      attemptId: session.attemptId,
      id: msg.id,
    });
    return;
  }
  session.pendingRequests.delete(msg.id);
  if (msg.error) {
    pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
  } else {
    pending.resolve(msg.result);
  }
}

function handleIncomingRequest(
  session: CodexSession,
  msg: JsonRpcRequest,
): void {
  // Phase A: we auto-decline any request from Codex since approval flow
  // isn't implemented yet. With approvalPolicy=never this should never
  // fire, but if Codex sends anything we don't recognize, fail closed.
  log.info("codex", "incoming request (auto-declining)", {
    attemptId: session.attemptId,
    method: msg.method,
    id: msg.id,
  });
  sendRaw(session, { id: msg.id, result: { decision: "decline" } });
}

function handleNotification(
  session: CodexSession,
  msg: JsonRpcNotification,
): void {
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "item/started":
      onItemStarted(session, params);
      break;
    case "item/updated":
      onItemUpdated(session, params);
      break;
    case "item/completed":
      onItemCompleted(session, params);
      break;
    case "item/agentMessage/delta":
      onAgentMessageDelta(session, params);
      break;
    case "turn/started":
      // Already emitted on our side at request time; ignore Codex's.
      break;
    case "turn/completed":
      onTurnCompleted(session, params);
      break;
    default:
      log.debug("codex", "unhandled notification", {
        attemptId: session.attemptId,
        method: msg.method,
      });
  }
}

// ─── Item translation ──────────────────────────────────────────────────────

interface RawItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string | string[];
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
  output?: string;
  path?: string;
  kind?: string | { type?: string };
  server?: string;
  tool?: string;
  query?: string;
  result?: string;
  [k: string]: unknown;
}

function getItemFromParams(params: Record<string, unknown>): RawItem | null {
  const item = (params.item ?? params) as RawItem;
  if (!item || typeof item.id !== "string") return null;
  return item;
}

function fileChangeKind(raw: RawItem): "create" | "edit" | "delete" | "modify" {
  const k = raw.kind;
  const s =
    typeof k === "string"
      ? k
      : k && typeof k === "object" && typeof k.type === "string"
        ? k.type
        : "modify";
  switch (s) {
    case "create":
    case "delete":
    case "edit":
    case "modify":
      return s;
    default:
      return "modify";
  }
}

function commandToString(raw: RawItem): string | string[] {
  const c = raw.command;
  if (Array.isArray(c)) return c;
  if (typeof c === "string") return c;
  return "";
}

function toAgentItem(raw: RawItem, state: AgentItemState): AgentItem {
  const kind = String(raw.type ?? "unknown");
  switch (kind) {
    case "agentMessage":
      return {
        id: raw.id!,
        kind: "message",
        state,
        text: typeof raw.text === "string" ? raw.text : "",
      };
    case "reasoning":
      return {
        id: raw.id!,
        kind: "reasoning",
        state,
        text: typeof raw.text === "string" ? raw.text : "",
      };
    case "commandExecution":
      return {
        id: raw.id!,
        kind: "command",
        state,
        command: commandToString(raw),
        cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
        exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
        durationMs:
          typeof raw.durationMs === "number" ? raw.durationMs : null,
        output: typeof raw.output === "string" ? raw.output : undefined,
      };
    case "fileChange":
      return {
        id: raw.id!,
        kind: "file_edit",
        state,
        path: typeof raw.path === "string" ? raw.path : "",
        changeKind: fileChangeKind(raw),
      };
    case "mcpToolCall":
      return {
        id: raw.id!,
        kind: "mcp_tool",
        state,
        server: typeof raw.server === "string" ? raw.server : undefined,
        tool: typeof raw.tool === "string" ? raw.tool : undefined,
        output: typeof raw.output === "string" ? raw.output : undefined,
      };
    case "webSearch":
      return {
        id: raw.id!,
        kind: "web_search",
        state,
        query: typeof raw.query === "string" ? raw.query : undefined,
        result: typeof raw.result === "string" ? raw.result : undefined,
      };
    default:
      return {
        id: raw.id!,
        kind: "unknown",
        state,
        raw,
      };
  }
}

function onItemStarted(
  session: CodexSession,
  params: Record<string, unknown>,
): void {
  const raw = getItemFromParams(params);
  if (!raw) return;
  session.itemMeta.set(raw.id!, { kind: String(raw.type ?? "unknown") });
  if (raw.type === "agentMessage" || raw.type === "reasoning") {
    session.itemTexts.set(raw.id!, "");
  }
  const item = toAgentItem(raw, "started");
  emit({ type: "agent_item", attemptId: session.attemptId, item });
}

function onItemUpdated(
  session: CodexSession,
  params: Record<string, unknown>,
): void {
  // For Phase A we don't distinguish updated from completed except for the
  // streaming delta path (handled separately). Forward as started so the UI
  // sees the latest snapshot.
  const raw = getItemFromParams(params);
  if (!raw) return;
  const item = toAgentItem(raw, "started");
  emit({ type: "agent_item", attemptId: session.attemptId, item });
}

function onItemCompleted(
  session: CodexSession,
  params: Record<string, unknown>,
): void {
  const raw = getItemFromParams(params);
  if (!raw) return;
  // For message/reasoning, merge accumulated text from deltas if Codex didn't
  // include the final text in the completed event.
  if (
    (raw.type === "agentMessage" || raw.type === "reasoning") &&
    (typeof raw.text !== "string" || raw.text.length === 0)
  ) {
    raw.text = session.itemTexts.get(raw.id!) ?? "";
  }
  const item = toAgentItem(raw, "completed");
  emit({ type: "agent_item", attemptId: session.attemptId, item });
  session.itemTexts.delete(raw.id!);
  session.itemMeta.delete(raw.id!);
}

function onAgentMessageDelta(
  session: CodexSession,
  params: Record<string, unknown>,
): void {
  const itemId =
    typeof params.itemId === "string"
      ? params.itemId
      : typeof (params.item as RawItem | undefined)?.id === "string"
        ? (params.item as RawItem).id!
        : null;
  const delta =
    typeof params.delta === "string"
      ? params.delta
      : typeof params.text === "string"
        ? (params.text as string)
        : "";
  if (!itemId || !delta) return;

  const prev = session.itemTexts.get(itemId) ?? "";
  session.itemTexts.set(itemId, prev + delta);

  emit({
    type: "agent_message_delta",
    attemptId: session.attemptId,
    itemId,
    delta,
  });
}

function onTurnCompleted(
  session: CodexSession,
  params: Record<string, unknown>,
): void {
  const turn = params.turn as { id?: string } | undefined;
  const turnId = (turn?.id ?? params.turnId ?? "") as string;
  const status =
    (params.status as "ok" | "failed" | "aborted" | undefined) ?? "ok";
  emit({
    type: "agent_turn_finished",
    attemptId: session.attemptId,
    turnId,
    status,
  });
}

// ─── Emit helper ───────────────────────────────────────────────────────────

function emit(msg: ServerMessage): void {
  // Persist to events.jsonl for replay, then broadcast over WS.
  // Skip ping/hello which aren't agent-scoped.
  const session = sessionFor(msg);
  if (session) {
    try {
      session.eventFile.write(JSON.stringify(msg) + "\n");
    } catch (err) {
      log.warn("codex", "event file write failed", {
        err: String(err),
      });
    }
  }
  broadcast(msg);
}

function sessionFor(msg: ServerMessage): CodexSession | null {
  const attemptId = (msg as { attemptId?: string }).attemptId;
  if (!attemptId) return null;
  return sessions.get(attemptId) ?? null;
}

// ─── Teardown ──────────────────────────────────────────────────────────────

function teardown(session: CodexSession, reason: string): void {
  if (!sessions.has(session.attemptId)) return;
  sessions.delete(session.attemptId);
  for (const [id, p] of session.pendingRequests) {
    p.reject(new Error(`session ended: ${reason}`));
    session.pendingRequests.delete(id);
  }
  try {
    session.proc.kill();
  } catch {
    // already dead
  }
  try {
    session.eventFile.end();
  } catch {
    // already closed
  }
  setCodexThreadId(session.attemptId, null);
  emit({
    type: "agent_stopped",
    attemptId: session.attemptId,
    reason,
  });
  log.info("codex", "torn down", {
    attemptId: session.attemptId,
    reason,
  });
}
