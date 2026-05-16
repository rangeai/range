/**
 * Codex adapter — one Codex thread per session.
 *
 * Spawns `codex app-server` as a subprocess inside the session's
 * worktree and talks JSON-RPC 2.0 newline-delimited over stdio.
 * Translates Codex's item lifecycle (item/started → optional
 * item/updated → item/completed, plus item/agentMessage/delta for
 * streaming text) into Range-native `agent_*` WebSocket events.
 *
 * MVP scope:
 *   - initialize / initialized / thread/start handshake
 *   - approvalPolicy: "never", sandbox: "read-only"
 *   - turn/start with input=[{type:"text",text:prompt}]
 *   - notification translation for agentMessage, reasoning, commandExecution
 *   - persist all observed events to ~/.range/threads/<session_id>/events.jsonl
 */

import type { Subprocess } from "bun";
import { mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./log.ts";
import { broadcast } from "./hub.ts";
import { getSession, setSessionCodexThreadId } from "./sessions.ts";
import { loadProfile } from "./profile.ts";
import type {
  AgentItem,
  AgentItemState,
  Sandbox,
  ServerAgentApprovalRequest,
  ServerMessage,
  Session,
} from "../shared/protocol.ts";

type Pending = {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
};

interface CodexSession {
  sessionId: string;
  proc: Subprocess<"pipe", "pipe", "pipe">;
  nextRequestId: number;
  pendingRequests: Map<number, Pending>;
  /** Codex → us approval requests awaiting browser decision, keyed by the
   *  Codex JSON-RPC request id (which is what we must echo on response). */
  pendingApprovals: Map<number, { method: string }>;
  threadId: string | null;
  itemTexts: Map<string, string>;
  itemMeta: Map<string, { kind: string }>;
  eventFile: WriteStream;
}

const sessions = new Map<string, CodexSession>();

function threadDir(sessionId: string): string {
  return join(homedir(), ".range", "threads", sessionId);
}

/**
 * Build the system-level context Codex carries through every turn.
 * Exposed so the UI can show the user exactly what Codex was told.
 */
export async function composeBaseInstructions(
  session: Session,
): Promise<string> {
  const lines: string[] = [];
  lines.push("You are an agent inside a Range session.");
  lines.push("");
  lines.push(`Session: ${session.id}`);
  lines.push(`Kind:    ${session.kind}`);
  lines.push(`Title:   ${session.title}`);
  if (session.repoPath) {
    lines.push(`Repo:    ${session.repoPath}`);
  } else {
    lines.push(
      "Repo:    (none attached — this session is freeform. If the user asks you to work on code, ask them to attach a repo from the UI.)",
    );
  }
  if (session.worktreePath) {
    lines.push(`Worktree: ${session.worktreePath}`);
  }
  if (session.branch) {
    lines.push(`Branch:  ${session.branch}`);
  }
  if (session.baseSha) {
    lines.push(`Base:    ${session.baseSha.slice(0, 12)}`);
  }
  lines.push(`Sandbox: ${session.sandbox}`);

  if (session.prompt && session.prompt !== session.title) {
    lines.push("");
    lines.push("The user's session prompt was:");
    for (const line of session.prompt.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  if (session.repoPath) {
    try {
      const profile = await loadProfile(session.repoPath);
      if (profile.profile && profile.profile.commands.length > 0) {
        lines.push("");
        lines.push("Available profile commands (range.yaml):");
        for (const cmd of profile.profile.commands) {
          const args = cmd.args.join(" ");
          const desc = cmd.description ? ` — ${cmd.description}` : "";
          lines.push(`  • ${cmd.name}: ${args}${desc}`);
        }
      }
      if (profile.profile && profile.profile.scenarios.length > 0) {
        lines.push("");
        lines.push("Available scenarios (range.yaml):");
        for (const sc of profile.profile.scenarios) {
          const sweep = sc.sweep
            ? ` ×${Object.values(sc.sweep.params).reduce(
                (a, v) => a * v.length,
                1,
              )}`
            : "";
          const desc = sc.description ? ` — ${sc.description}` : "";
          lines.push(`  • ${sc.name}${sweep}${desc}`);
        }
      }
    } catch {
      // ignore profile load errors; instructions just won't include them
    }
  }

  lines.push("");
  lines.push("You have a `range` CLI on PATH that speaks the Range API directly.");
  lines.push("Prefer it over `curl` to the REST endpoints. Key commands:");
  lines.push("  range sessions current           ← this session's metadata");
  lines.push("  range scenarios list             ← scenarios from range.yaml");
  lines.push("  range scenarios run <name> --follow --timeout 600");
  lines.push("                                    launches a scenario (or sweep)");
  lines.push("                                    and blocks until it finishes");
  lines.push("  range commands list");
  lines.push("  range commands run <name> --follow");
  lines.push("  range runs list [--scenario X] [--state failed] [--since 1h] [--json]");
  lines.push("  range runs show <id> [--json]    ← state + metrics + metadata");
  lines.push("  range runs metrics <id> --json   ← parsed metrics.json");
  lines.push("  range runs artifacts <id>        ← USD/video/csv outputs");
  lines.push("  range runs logs <id> [--tail 50] ← captured stdout/stderr");
  lines.push("  range runs wait <id> [--timeout 600]");
  lines.push("  range runs compare <id1> <id2> [...]   ← side-by-side metrics table");
  lines.push("  range gates list | results       ← verification gates + results");
  lines.push("  range pr draft --json            ← compose a PR title + body");
  lines.push("  range pr open --title T --body-file F  (after `git push`)");
  lines.push("");
  lines.push("Append --json to read commands when you want structured output.");
  lines.push("RANGE_SESSION is preset in your env, so commands resolve to this session.");

  lines.push("");
  lines.push(
    "Be terse, factual, and evidence-based. When unsure, run a small command to check rather than guess.",
  );

  return lines.join("\n");
}

export function isAgentRunning(sessionId: string): boolean {
  return sessions.has(sessionId);
}

/**
 * Read persisted agent events for a session. Returns the tail of the
 * thread's events.jsonl so we don't ship huge histories — sessions
 * with very long output get truncated to the last MAX bytes.
 */
export async function readAgentHistory(
  sessionId: string,
): Promise<{ events: ServerMessage[] }> {
  const MAX = 512 * 1024;
  const path = join(threadDir(sessionId), "events.jsonl");
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return { events: [] };
    const size = file.size;
    const start = Math.max(0, size - MAX);
    const slice = file.slice(start, size);
    const text = await slice.text();
    const lines = text.split("\n").filter((l) => l.length > 0);
    if (start > 0 && lines.length > 0) lines.shift();
    const events: ServerMessage[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as ServerMessage);
      } catch {
        // skip malformed
      }
    }
    return { events };
  } catch (err) {
    log.warn("codex", "readAgentHistory failed", {
      sessionId,
      err: String(err instanceof Error ? err.message : err),
    });
    return { events: [] };
  }
}

export interface StartAgentOptions {
  /** Override the session.sandbox for this start. */
  sandbox?: Sandbox;
}

export async function startAgent(
  sessionId: string,
  options: StartAgentOptions = {},
): Promise<{ threadId: string }> {
  if (sessions.has(sessionId)) {
    const s = sessions.get(sessionId)!;
    return { threadId: s.threadId ?? "" };
  }

  const session = getSession(sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);

  const sandbox: Sandbox = options.sandbox ?? session.sandbox;
  // workspace-write gates risky ops behind approvals; read-only auto-approves
  // (there's nothing dangerous to do). If the user has flipped on
  // autoApprove for this session, fall through to "never" regardless.
  let approvalPolicy: "never" | "on-request" =
    sandbox === "workspace-write" || sandbox === "danger-full-access"
      ? "on-request"
      : "never";
  if (session.autoApprove) approvalPolicy = "never";

  const dir = threadDir(sessionId);
  await mkdir(dir, { recursive: true });
  const eventFile = createWriteStream(join(dir, "events.jsonl"), {
    flags: "a",
  });

  // Codex always needs a cwd. For sessions without a worktree, fall back
  // to the session's thread dir — a private scratch space Range owns.
  const cwd = session.worktreePath ?? dir;
  log.info("codex", "spawning", { sessionId, cwd });

  // Resolve the `range` CLI shim's directory and prepend it to PATH so
  // Codex can invoke `range scenarios run …` etc. without an absolute
  // path. Also inject session + server discovery env so the CLI
  // auto-resolves to *this* server and *this* session.
  const cliDir = join(import.meta.dir, "..", "cli");
  const port = process.env.RANGE_PORT ?? "3457";
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: `${cliDir}:${process.env.PATH ?? ""}`,
    RANGE_URL: process.env.RANGE_URL ?? `http://127.0.0.1:${port}`,
    RANGE_SESSION: sessionId,
  };

  let proc: Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["codex", "app-server"], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
  } catch (err) {
    eventFile.end();
    throw new Error(`failed to spawn codex app-server: ${err}`);
  }

  const cs: CodexSession = {
    sessionId,
    proc,
    nextRequestId: 1,
    pendingRequests: new Map(),
    pendingApprovals: new Map(),
    threadId: null,
    itemTexts: new Map(),
    itemMeta: new Map(),
    eventFile,
  };
  sessions.set(sessionId, cs);

  void readLoop(cs).catch((err) => {
    log.error("codex", "read loop crashed", {
      sessionId,
      err: String(err),
    });
    teardown(cs, `read loop crashed: ${err}`);
  });
  void teeStderr(cs).catch(() => undefined);

  emit({
    type: "agent_started",
    sessionId,
    threadId: "<initializing>",
  });

  try {
    await sendRequest(cs, "initialize", {
      clientInfo: { name: "range", version: "0.1.0" },
      capabilities: {},
    });
    sendNotification(cs, "initialized", {});

    const baseInstructions = await composeBaseInstructions(session);
    const threadResp = (await sendRequest(cs, "thread/start", {
      cwd,
      approvalPolicy,
      sandbox,
      baseInstructions,
    })) as { thread?: { id?: string }; threadId?: string };

    const threadId =
      threadResp?.thread?.id ?? threadResp?.threadId ?? "";
    if (!threadId) {
      throw new Error("thread/start returned no thread id");
    }
    cs.threadId = threadId;
    setSessionCodexThreadId(sessionId, threadId);

    log.info("codex", "thread started", { sessionId, threadId });
    emit({ type: "agent_started", sessionId, threadId });
    const updated = getSession(sessionId);
    if (updated)
      broadcast({ type: "session_updated", session: updated });

    return { threadId };
  } catch (err) {
    log.error("codex", "handshake failed", {
      sessionId,
      err: String(err),
    });
    teardown(cs, `handshake failed: ${err}`);
    throw err;
  }
}

export async function sendUserMessage(
  sessionId: string,
  prompt: string,
): Promise<{ turnId: string }> {
  const cs = sessions.get(sessionId);
  if (!cs || !cs.threadId) {
    throw new Error(`no live Codex session for ${sessionId}`);
  }

  const resp = (await sendRequest(cs, "turn/start", {
    threadId: cs.threadId,
    input: [{ type: "text", text: prompt }],
  })) as { turn?: { id?: string }; turnId?: string };

  const turnId = resp?.turn?.id ?? resp?.turnId ?? "";
  emit({
    type: "agent_turn_started",
    sessionId,
    turnId,
    prompt,
  });
  return { turnId };
}

export async function stopAgent(sessionId: string): Promise<boolean> {
  const cs = sessions.get(sessionId);
  if (!cs) return false;
  teardown(cs, "stopped by user");
  return true;
}

// ─── JSON-RPC plumbing ─────────────────────────────────────────────────────

function sendRaw(cs: CodexSession, payload: unknown): void {
  try {
    cs.proc.stdin.write(JSON.stringify(payload) + "\n");
  } catch (err) {
    log.error("codex", "stdin write failed", {
      sessionId: cs.sessionId,
      err: String(err),
    });
  }
}

function sendNotification(
  cs: CodexSession,
  method: string,
  params: Record<string, unknown>,
): void {
  sendRaw(cs, { method, params });
}

function sendRequest(
  cs: CodexSession,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<unknown> {
  const id = cs.nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cs.pendingRequests.delete(id);
      reject(new Error(`Codex request ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    cs.pendingRequests.set(id, {
      resolve: (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    sendRaw(cs, { method, id, params });
  });
}

async function readLoop(cs: CodexSession): Promise<void> {
  const reader = cs.proc.stdout;
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
        handleMessage(cs, msg);
      } catch (err) {
        log.warn("codex", "non-JSON line", {
          sessionId: cs.sessionId,
          err: String(err),
          line: line.slice(0, 200),
        });
      }
    }
  }
  const exitCode = await cs.proc.exited;
  log.info("codex", "process exited", {
    sessionId: cs.sessionId,
    exitCode,
  });
  teardown(cs, `exited code=${exitCode}`);
}

async function teeStderr(cs: CodexSession): Promise<void> {
  const reader = cs.proc.stderr;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of reader as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length === 0) continue;
      log.warn("codex.stderr", line, { sessionId: cs.sessionId });
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

function handleMessage(cs: CodexSession, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;

  if (typeof m.id === "number" && ("result" in m || "error" in m)) {
    handleResponse(cs, m as unknown as JsonRpcResponse);
    return;
  }
  if (typeof m.method === "string" && typeof m.id === "number") {
    handleIncomingRequest(cs, m as unknown as JsonRpcRequest);
    return;
  }
  if (typeof m.method === "string") {
    handleNotification(cs, m as unknown as JsonRpcNotification);
    return;
  }
}

function handleResponse(cs: CodexSession, msg: JsonRpcResponse): void {
  const pending = cs.pendingRequests.get(msg.id);
  if (!pending) {
    log.warn("codex", "response with no pending request", {
      sessionId: cs.sessionId,
      id: msg.id,
    });
    return;
  }
  cs.pendingRequests.delete(msg.id);
  if (msg.error) {
    pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
  } else {
    pending.resolve(msg.result);
  }
}

function handleIncomingRequest(cs: CodexSession, msg: JsonRpcRequest): void {
  log.info("codex", "incoming request", {
    sessionId: cs.sessionId,
    method: msg.method,
    id: msg.id,
  });
  cs.pendingApprovals.set(msg.id, { method: msg.method });

  const params = (msg.params ?? {}) as Record<string, unknown>;
  const kind = classifyApproval(msg.method);
  const payload: ServerAgentApprovalRequest["payload"] = {};
  const raw = (params.item ?? params) as Record<string, unknown>;

  if (typeof raw.command !== "undefined") {
    payload.command = raw.command as string | string[];
  }
  if (typeof raw.cwd === "string") payload.cwd = raw.cwd;
  if (typeof raw.path === "string") payload.path = raw.path;
  const k = raw.kind;
  if (typeof k === "string") {
    payload.changeKind = k as ServerAgentApprovalRequest["payload"]["changeKind"];
  } else if (
    k &&
    typeof k === "object" &&
    typeof (k as Record<string, unknown>).type === "string"
  ) {
    payload.changeKind = (k as { type: string })
      .type as ServerAgentApprovalRequest["payload"]["changeKind"];
  }
  if (typeof raw.description === "string") payload.description = raw.description;
  payload.raw = params;

  // If this is a command approval and the underlying binary is in the
  // session's allowlist, auto-accept on the user's behalf — no card,
  // no wait. Other approval kinds (file_edit, permissions) still
  // require explicit approval.
  if (kind === "command") {
    const session = getSession(cs.sessionId);
    const binary = approvalBinary(payload.command);
    if (
      session &&
      binary &&
      session.allowedCommands.includes(binary.toLowerCase())
    ) {
      log.info("codex", "auto-approve (allowlist)", {
        sessionId: cs.sessionId,
        binary,
        requestId: msg.id,
      });
      respondToApproval(cs.sessionId, msg.id, "accept");
      return;
    }
  }

  emit({
    type: "agent_approval_request",
    sessionId: cs.sessionId,
    requestId: msg.id,
    kind,
    payload,
  });
}

/** Pull the user-meaningful binary name out of a Codex command payload.
 *  Codex tends to wrap things as ["/bin/zsh","-lc","actual cmd"]; we
 *  strip that wrapper and take the first token of the actual command.
 *  Matches the prettyCommand logic on the frontend. */
export function approvalBinary(
  command: string | string[] | undefined,
): string | null {
  if (!command) return null;
  const joined = Array.isArray(command) ? command.join(" ") : command;
  const wrapped = joined.match(
    /^\/bin\/(?:ba|z)sh\s+-l?c\s+(['"])(.*)\1\s*$/s,
  );
  const inner = wrapped ? wrapped[2]! : joined;
  const tok = inner.trim().split(/\s+/, 1)[0] ?? "";
  if (!tok) return null;
  // Strip env-var prefixes like FOO=1 BAR=2 cmd …
  // The first token shouldn't be an assignment; if it is, take next.
  if (tok.includes("=")) {
    const rest = inner.trim().split(/\s+/);
    for (const t of rest) {
      if (!t.includes("=")) return t.split("/").pop() ?? t;
    }
    return null;
  }
  return tok.split("/").pop() ?? tok;
}

function classifyApproval(
  method: string,
): ServerAgentApprovalRequest["kind"] {
  if (method.includes("commandExecution")) return "command";
  if (method.includes("execCommand")) return "exec";
  if (method.includes("fileChange") || method.includes("applyPatch"))
    return "file_edit";
  if (method.includes("permissions")) return "permissions";
  return "unknown";
}

export function respondToApproval(
  sessionId: string,
  requestId: number,
  decision: "accept" | "decline",
): boolean {
  const cs = sessions.get(sessionId);
  if (!cs) return false;
  const pending = cs.pendingApprovals.get(requestId);
  if (!pending) return false;
  cs.pendingApprovals.delete(requestId);
  sendRaw(cs, { id: requestId, result: { decision } });
  emit({
    type: "agent_approval_resolved",
    sessionId,
    requestId,
    decision,
  });
  log.info("codex", "approval resolved", {
    sessionId,
    requestId,
    method: pending.method,
    decision,
  });
  return true;
}

function handleNotification(
  cs: CodexSession,
  msg: JsonRpcNotification,
): void {
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "item/started":
      onItemStarted(cs, params);
      break;
    case "item/updated":
      onItemUpdated(cs, params);
      break;
    case "item/completed":
      onItemCompleted(cs, params);
      break;
    case "item/agentMessage/delta":
      onAgentMessageDelta(cs, params);
      break;
    case "turn/started":
      break;
    case "turn/completed":
      onTurnCompleted(cs, params);
      break;
    default:
      log.debug("codex", "unhandled notification", {
        sessionId: cs.sessionId,
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
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const raw = getItemFromParams(params);
  if (!raw) return;
  cs.itemMeta.set(raw.id!, { kind: String(raw.type ?? "unknown") });
  if (raw.type === "agentMessage" || raw.type === "reasoning") {
    cs.itemTexts.set(raw.id!, "");
  }
  const item = toAgentItem(raw, "started");
  emit({ type: "agent_item", sessionId: cs.sessionId, item });
}

function onItemUpdated(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const raw = getItemFromParams(params);
  if (!raw) return;
  const item = toAgentItem(raw, "started");
  emit({ type: "agent_item", sessionId: cs.sessionId, item });
}

function onItemCompleted(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const raw = getItemFromParams(params);
  if (!raw) return;
  if (
    (raw.type === "agentMessage" || raw.type === "reasoning") &&
    (typeof raw.text !== "string" || raw.text.length === 0)
  ) {
    raw.text = cs.itemTexts.get(raw.id!) ?? "";
  }
  const item = toAgentItem(raw, "completed");
  emit({ type: "agent_item", sessionId: cs.sessionId, item });
  cs.itemTexts.delete(raw.id!);
  cs.itemMeta.delete(raw.id!);
}

function onAgentMessageDelta(
  cs: CodexSession,
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

  const prev = cs.itemTexts.get(itemId) ?? "";
  cs.itemTexts.set(itemId, prev + delta);

  emit({
    type: "agent_message_delta",
    sessionId: cs.sessionId,
    itemId,
    delta,
  });
}

function onTurnCompleted(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const turn = params.turn as { id?: string } | undefined;
  const turnId = (turn?.id ?? params.turnId ?? "") as string;
  const status =
    (params.status as "ok" | "failed" | "aborted" | undefined) ?? "ok";
  emit({
    type: "agent_turn_finished",
    sessionId: cs.sessionId,
    turnId,
    status,
  });
}

function emit(msg: ServerMessage): void {
  const sessionId = (msg as { sessionId?: string }).sessionId;
  if (sessionId) {
    const cs = sessions.get(sessionId);
    if (cs) {
      try {
        cs.eventFile.write(JSON.stringify(msg) + "\n");
      } catch (err) {
        log.warn("codex", "event file write failed", {
          err: String(err),
        });
      }
    }
  }
  broadcast(msg);
}

function teardown(cs: CodexSession, reason: string): void {
  if (!sessions.has(cs.sessionId)) return;
  sessions.delete(cs.sessionId);
  for (const [id, p] of cs.pendingRequests) {
    p.reject(new Error(`session ended: ${reason}`));
    cs.pendingRequests.delete(id);
  }
  try {
    cs.proc.kill();
  } catch {
    // already dead
  }
  try {
    cs.eventFile.end();
  } catch {
    // already closed
  }
  setSessionCodexThreadId(cs.sessionId, null);
  emit({
    type: "agent_stopped",
    sessionId: cs.sessionId,
    reason,
  });
  const updated = getSession(cs.sessionId);
  if (updated) broadcast({ type: "session_updated", session: updated });
  log.info("codex", "torn down", {
    sessionId: cs.sessionId,
    reason,
  });
}
