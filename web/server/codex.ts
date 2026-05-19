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
import { SshStaticProvider } from "./remote/ssh_static.ts";
import type {
  EnvironmentHandle,
  Machine,
  RemoteProvider,
} from "./remote/provider.ts";
import { setSessionRemote } from "./remote/registry.ts";
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
  /** Last point at which we exchanged any data with Codex (incoming
   *  notification, outgoing turn). Used by the idle sweeper to decide
   *  when to shut a session down. */
  lastActivityAt: number;
  /** If this session is running codex on a remote provider, the
   *  handle is stashed here so shutdown() can call standDown(). Null
   *  for local sessions. */
  remote: {
    provider: RemoteProvider;
    machine: Machine;
    env: EnvironmentHandle;
  } | null;
}

const sessions = new Map<string, CodexSession>();

/** Idle-shutdown horizon. After this many ms with no Codex activity
 *  and no in-flight turn, the per-session Codex process is torn down.
 *  Bring-up cost on next use is ~2–5s (Codex spawn + thread/resume).
 */
const IDLE_SHUTDOWN_MS = 20 * 60 * 1000;
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000;

function touchActivity(cs: CodexSession): void {
  cs.lastActivityAt = Date.now();
}

let idleSweeper: ReturnType<typeof setInterval> | null = null;
function ensureIdleSweeper(): void {
  if (idleSweeper) return;
  idleSweeper = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, cs] of sessions) {
      // Don't reap a session with pending JSON-RPC traffic — that means a
      // turn is mid-flight (sendRequest hasn't resolved).
      if (cs.pendingRequests.size > 0) continue;
      if (now - cs.lastActivityAt < IDLE_SHUTDOWN_MS) continue;
      log.info("codex", "idle shutdown", {
        sessionId,
        idleMs: now - cs.lastActivityAt,
      });
      void stopAgent(sessionId).catch((err) =>
        log.warn("codex", "idle shutdown failed", {
          sessionId,
          err: String(err instanceof Error ? err.message : err),
        }),
      );
    }
  }, IDLE_SWEEP_INTERVAL_MS);
}

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
/** Archive the persisted event log so the next session view rehydration
 *  starts with a blank slate. The old log moves to events.jsonl.<ts>
 *  next to it; we never delete history outright. */
export async function archiveAgentHistory(sessionId: string): Promise<void> {
  // /clear semantics: we want a *fresh* conversation, not a resumed
  // one — drop the persisted thread id so next start does thread/start
  // rather than thread/resume.
  setSessionCodexThreadId(sessionId, null);

  const dir = threadDir(sessionId);
  const src = join(dir, "events.jsonl");
  try {
    const exists = await Bun.file(src).exists();
    if (!exists) return;
    const ts = new Date()
      .toISOString()
      .replace(/[:T.Z]/g, "")
      .slice(0, 14);
    const dst = join(dir, `events.jsonl.${ts}`);
    const { rename } = await import("node:fs/promises");
    await rename(src, dst);
    log.info("codex", "history archived", { sessionId, dst });
  } catch (err) {
    log.warn("codex", "history archive failed", {
      sessionId,
      err: String(err instanceof Error ? err.message : err),
    });
  }
}

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
  let remoteHandle: {
    provider: RemoteProvider;
    machine: Machine;
    env: EnvironmentHandle;
  } | null = null;

  if (session.remoteConfig) {
    // Coordinator mode: provision/setup a remote, then spawn codex
    // app-server over the SSH transport. The stdio pair lives across
    // the tunnel — JSON-RPC framing is byte-identical to local.
    try {
      const provider = new SshStaticProvider({
        host: session.remoteConfig.host,
        identityFile: session.remoteConfig.identityFile,
        remoteWorkspaceRoot: session.remoteConfig.remoteWorkspaceRoot,
      });
      const machine = await provider.provision({});
      const envHandle = await provider.setup(machine, {
        sessionId,
        repoPath: session.repoPath ?? cwd,
        agentKind: "codex",
        // Remote codex doesn't reach back to a local Range URL — the
        // range CLI shim isn't on the remote PATH and shouldn't be
        // needed for the agent's stdio JSON-RPC. Drop those.
        remoteEnv: {},
      });
      remoteHandle = { provider, machine, env: envHandle };
      setSessionRemote(sessionId, remoteHandle);
      // Disable the `unified_exec` codex feature on the remote — its
      // Linux sandbox implementation hits "Failed to create unified
      // exec process: No such file or directory (os error 2)" on
      // boxes we've tested (kernel 5.15). The older shell_tool path
      // works fine. Flip back on once codex's Linux unified-exec is
      // settled upstream.
      proc = envHandle.spawn(
        ["codex", "app-server", "--disable", "unified_exec"],
        { cwd: envHandle.remoteRepoPath },
      );
      log.info("codex", "spawned remotely", {
        sessionId,
        host: session.remoteConfig.host,
        remoteRepoPath: envHandle.remoteRepoPath,
      });
    } catch (err) {
      eventFile.end();
      throw new Error(
        `failed to spawn codex app-server on remote: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
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
    lastActivityAt: Date.now(),
    remote: remoteHandle,
  };
  sessions.set(sessionId, cs);
  ensureIdleSweeper();

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
    const threadParams: Record<string, unknown> = {
      cwd,
      approvalPolicy,
      sandbox,
      baseInstructions,
    };
    if (session.model) threadParams.model = session.model;
    if (session.reasoningEffort) {
      threadParams.effort = session.reasoningEffort;
      threadParams.reasoningEffort = session.reasoningEffort;
    }

    // If the session already has a persisted thread, resume it so the
    // user's prior context survives idle-shutdown / process restarts.
    // Resume falls back to a fresh start if Codex says the thread is
    // gone (e.g. on-disk store cleared).
    const existingThreadId = session.codexThreadId;
    let threadResp:
      | { thread?: { id?: string }; threadId?: string }
      | undefined;
    if (existingThreadId) {
      try {
        threadResp = (await sendRequest(cs, "thread/resume", {
          ...threadParams,
          threadId: existingThreadId,
        })) as { thread?: { id?: string }; threadId?: string };
        log.info("codex", "thread resumed", {
          sessionId,
          threadId: existingThreadId,
        });
      } catch (err) {
        log.warn("codex", "resume failed, starting fresh thread", {
          sessionId,
          existingThreadId,
          err: String(err instanceof Error ? err.message : err),
        });
        threadResp = undefined;
      }
    }
    if (!threadResp) {
      threadResp = (await sendRequest(cs, "thread/start", threadParams)) as {
        thread?: { id?: string };
        threadId?: string;
      };
    }

    const threadId =
      threadResp?.thread?.id ?? threadResp?.threadId ?? existingThreadId ?? "";
    if (!threadId) {
      throw new Error("thread/start returned no thread id");
    }
    cs.threadId = threadId;
    setSessionCodexThreadId(sessionId, threadId);

    log.info("codex", "thread ready", { sessionId, threadId });
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
  // Lazy-start: if the session's Codex isn't running (idle-shutdown,
  // never opened, etc.), spin it up first.
  let cs = sessions.get(sessionId);
  if (!cs || !cs.threadId) {
    await startAgent(sessionId);
    cs = sessions.get(sessionId);
  }
  if (!cs || !cs.threadId) {
    throw new Error(`failed to start Codex for ${sessionId}`);
  }
  touchActivity(cs);

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

/**
 * Synchronously tear down every running Codex child. Called from the
 * server's SIGINT/SIGTERM handler so we don't leak children when the
 * server exits.
 */
export function stopAllAgents(): void {
  const ids = [...sessions.keys()];
  for (const id of ids) {
    const cs = sessions.get(id);
    if (!cs) continue;
    try {
      cs.proc.kill("SIGKILL");
    } catch {
      /* best-effort */
    }
    teardown(cs, "server shutdown");
  }
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
        // Any incoming traffic counts as activity — keeps a busy
        // session alive past the idle horizon.
        touchActivity(cs);
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
    case "thread/tokenUsage/updated":
      onTokenUsageUpdated(cs, params);
      break;
    case "turn/diff/updated":
      onTurnDiffUpdated(cs, params);
      break;
    case "thread/compacted":
      onThreadCompacted(cs, params);
      break;
    case "turn/plan/updated":
      onTurnPlanUpdated(cs, params);
      break;
    default:
      log.debug("codex", "unhandled notification", {
        sessionId: cs.sessionId,
        method: msg.method,
      });
  }
}

function onTokenUsageUpdated(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const threadId = (params.threadId as string | undefined) ?? cs.threadId ?? "";
  const turnId = (params.turnId as string | undefined) ?? "";
  const usage = params.tokenUsage as
    | {
        last: Record<string, number>;
        total: Record<string, number>;
        modelContextWindow?: number | null;
      }
    | undefined;
  if (!usage) return;
  emit({
    type: "agent_token_usage",
    sessionId: cs.sessionId,
    threadId,
    turnId,
    usage: {
      last: {
        cachedInputTokens: usage.last.cachedInputTokens ?? 0,
        inputTokens: usage.last.inputTokens ?? 0,
        outputTokens: usage.last.outputTokens ?? 0,
        reasoningOutputTokens: usage.last.reasoningOutputTokens ?? 0,
        totalTokens: usage.last.totalTokens ?? 0,
      },
      total: {
        cachedInputTokens: usage.total.cachedInputTokens ?? 0,
        inputTokens: usage.total.inputTokens ?? 0,
        outputTokens: usage.total.outputTokens ?? 0,
        reasoningOutputTokens: usage.total.reasoningOutputTokens ?? 0,
        totalTokens: usage.total.totalTokens ?? 0,
      },
      modelContextWindow: usage.modelContextWindow ?? null,
    },
  });
}

function onTurnDiffUpdated(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const threadId = (params.threadId as string | undefined) ?? cs.threadId ?? "";
  const turnId = (params.turnId as string | undefined) ?? "";
  const diff = typeof params.diff === "string" ? params.diff : "";
  emit({
    type: "agent_turn_diff",
    sessionId: cs.sessionId,
    threadId,
    turnId,
    diff,
  });
}

function onThreadCompacted(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const threadId = (params.threadId as string | undefined) ?? cs.threadId ?? "";
  const turnId = (params.turnId as string | undefined) ?? "";
  emit({
    type: "agent_compacted",
    sessionId: cs.sessionId,
    threadId,
    turnId,
  });
}

/**
 * Codex's `turn/plan/updated` notification carries the agent's
 * latest plan (an ordered list of `{step, status}` pairs).
 * Status arrives in camelCase from Codex; we normalize to
 * snake_case to match Range's protocol-wide naming convention.
 */
function onTurnPlanUpdated(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const threadId =
    (params.threadId as string | undefined) ?? cs.threadId ?? "";
  const turnId = (params.turnId as string | undefined) ?? "";
  const rawPlan = Array.isArray(params.plan) ? params.plan : [];
  const plan = rawPlan
    .map((entry) => {
      const r = entry as { step?: unknown; status?: unknown };
      if (typeof r.step !== "string") return null;
      const rawStatus = typeof r.status === "string" ? r.status : "pending";
      const status =
        rawStatus === "inProgress"
          ? "in_progress"
          : rawStatus === "completed"
            ? "completed"
            : "pending";
      return { step: r.step, status };
    })
    .filter((s): s is { step: string; status: "pending" | "in_progress" | "completed" } => s !== null);
  const explanation =
    typeof params.explanation === "string" ? params.explanation : null;
  emit({
    type: "agent_plan_updated",
    sessionId: cs.sessionId,
    threadId,
    turnId,
    plan,
    explanation,
  });
}

/** Request Codex to compact its conversation in place. Returns once the
 *  thread/compact/start RPC has been acknowledged; the actual compaction
 *  proceeds asynchronously and fires `thread/compacted` when done. */
export async function compactThread(sessionId: string): Promise<void> {
  const cs = sessions.get(sessionId);
  if (!cs || !cs.threadId) {
    throw new Error(`no live Codex session for ${sessionId}`);
  }
  await sendRequest(cs, "thread/compact/start", {
    threadId: cs.threadId,
  });
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
  // Flush any pending coalesced deltas for this item BEFORE we send
  // the completion message, so the browser applies them in order.
  if (raw.id) flushDelta(cs.sessionId, raw.id);
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

// ─── Delta coalescing ─────────────────────────────────────────────────────
// Codex emits item/agentMessage/delta one token at a time. Forwarding
// each one to the browser as its own WS frame produces ~60 store
// updates per second and ~60 React re-renders. Buffer per
// (sessionId, itemId); flush every COALESCE_MS into a single combined
// delta. Trailing text is flushed explicitly when the item completes
// or the turn ends.

const COALESCE_MS = 16;
const pendingDeltas = new Map<string, string>();
const pendingFlushTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function deltaKey(sessionId: string, itemId: string): string {
  return `${sessionId}:${itemId}`;
}

function flushDelta(sessionId: string, itemId: string): void {
  const key = deltaKey(sessionId, itemId);
  const timer = pendingFlushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingFlushTimers.delete(key);
  }
  const buffered = pendingDeltas.get(key);
  if (!buffered) return;
  pendingDeltas.delete(key);
  emit({
    type: "agent_message_delta",
    sessionId,
    itemId,
    delta: buffered,
  });
}

function flushPendingForSession(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of [...pendingDeltas.keys()]) {
    if (key.startsWith(prefix)) {
      const itemId = key.slice(prefix.length);
      flushDelta(sessionId, itemId);
    }
  }
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

  const key = deltaKey(cs.sessionId, itemId);
  pendingDeltas.set(key, (pendingDeltas.get(key) ?? "") + delta);
  if (!pendingFlushTimers.has(key)) {
    const t = setTimeout(() => flushDelta(cs.sessionId, itemId), COALESCE_MS);
    pendingFlushTimers.set(key, t);
  }
}

function onTurnCompleted(
  cs: CodexSession,
  params: Record<string, unknown>,
): void {
  const turn = params.turn as { id?: string } | undefined;
  const turnId = (turn?.id ?? params.turnId ?? "") as string;
  const status =
    (params.status as "ok" | "failed" | "aborted" | undefined) ?? "ok";
  // Flush any coalesced deltas that haven't fired yet so the browser
  // sees the trailing text before turn_finished fans out.
  flushPendingForSession(cs.sessionId);
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
  // Note: we intentionally do NOT clear the remote registry or call
  // provider.standDown() here. The EnvironmentHandle should outlive
  // codex's idle-shutdown/respawn cycle — scenario runs can still fire
  // while codex is asleep, and they need the same handle to spawn on
  // the remote. Provider.standDown is reserved for session deletion
  // (the moment when we truly stop caring about the machine), which
  // is handled in sessions.ts.
  // Keep codex_thread_id persisted across teardown so the next
  // start can `thread/resume` into the same conversation. Only
  // archiveAgentHistory (`/clear`) clears it deliberately.
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

// ─── AgentBackend adapter ─────────────────────────────────────────────────
//
// The functions above existed before Range had a backend abstraction.
// They stay (server/index.ts still imports them by name today) and we
// also expose a `codexBackend` value that implements AgentBackend by
// delegating into them. Once every caller routes through the agent
// registry the free exports can be dropped — but for now they're a
// thin compatibility shim.

import type { AgentBackend } from "./agent.ts";
import { registerBackend } from "./agent.ts";

export const codexBackend: AgentBackend = {
  name: "codex",
  features: {
    compact: true,
    resume: true,
    pushTokenUsage: true,
    pushTurnDiff: true,
    plans: true,
  },
  start(sessionId, options) {
    return startAgent(sessionId, options ?? {});
  },
  stop(sessionId) {
    return stopAgent(sessionId);
  },
  isRunning(sessionId) {
    return isAgentRunning(sessionId);
  },
  sendMessage(sessionId, prompt) {
    return sendUserMessage(sessionId, prompt);
  },
  respondToApproval(sessionId, requestId, decision) {
    return respondToApproval(sessionId, requestId, decision);
  },
  compact(sessionId) {
    return compactThread(sessionId);
  },
  shutdownAll() {
    stopAllAgents();
  },
  // Codex's CLI exposes slash commands like `/init`, `/agents`,
  // `/tools` — but those are TUI-side, not in the app-server
  // JSON-RPC schema. No native API surface to bridge yet; we
  // populate this list once Codex's app-server exposes a command
  // catalog.
  nativeCommands: [],
};

// Register on module load so the first import wires the backend
// into the registry. Side-effect-on-import is intentional here —
// the registry is otherwise empty.
registerBackend(codexBackend);
