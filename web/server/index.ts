/**
 * Range MVP server.
 *
 * Sessions are the sole top-level work container. Each session with a
 * repo_path owns one worktree, one Codex thread, and one stream of runs.
 *
 * REST surface:
 *   GET  /api/health
 *   GET  /api/sessions
 *   POST /api/sessions
 *   GET  /api/sessions/:id
 *   GET  /api/sessions/:id/profile
 *   GET  /api/sessions/:id/runs
 *   POST /api/sessions/:id/runs
 *   GET  /api/runs/:id
 *   POST /api/runs/:id/abort
 *   POST /api/sessions/:id/agent/start
 *   POST /api/sessions/:id/agent/message
 *   POST /api/sessions/:id/agent/stop
 *   GET  /ws
 */

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { log } from "./log.ts";
import type {
  AgentMessageRequest,
  AgentMessageResponse,
  ClientAgentApprovalResponse,
  CreateRunRequest,
  CreateRunResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetProfileResponse,
  GetRunResponse,
  GetSessionResponse,
  ListRunsResponse,
  ListSessionsResponse,
  OpenPrRequest,
  OpenPrResponse,
  PrDraftResponse,
  RunKind,
  RunScenarioResponse,
  Sandbox,
  ServerMessage,
  StartAgentRequest,
  StartAgentResponse,
} from "../shared/protocol.ts";
import "./db.ts";
import {
  allowCommand,
  attachRepo,
  createSession,
  deleteSession,
  disallowCommand,
  getSession,
  listSessions,
  setSessionAutoApprove,
  setSessionModel,
  setSessionReasoningEffort,
  setSessionSandbox,
  validateRepoPath,
} from "./sessions.ts";
import {
  getRun,
  listRunsBySession,
} from "./runs.ts";
import {
  abortRun,
  listRunArtifacts,
  readRunEvents,
  startRun,
} from "./runner.ts";
import { loadProfile } from "./profile.ts";
import { getLatestResults } from "./verification.ts";
import { draftPr, openPr } from "./pr.ts";
import { listDirectory, homeDir } from "./fs_browse.ts";
import { runScenario } from "./scenarios.ts";
import {
  archiveAgentHistory,
  composeBaseInstructions,
  isAgentRunning,
  readAgentHistory,
  respondToApproval,
  sendUserMessage,
  startAgent,
  stopAgent,
} from "./codex.ts";
import { broadcast, registerSender } from "./hub.ts";

const VERSION = "0.1.0";
const PORT = Number(Bun.env.RANGE_PORT ?? 3457);

const { upgradeWebSocket, websocket } =
  createBunWebSocket<ServerWebSocket>();

const app = new Hono();

// ─── Health ────────────────────────────────────────────────────────────────

app.get("/api/health", (c) =>
  c.json({ ok: true, server: "range", version: VERSION, t: Date.now() }),
);

// ─── FS browser (for the attach-repo picker) ─────────────────────────────

app.get("/api/fs/list", async (c) => {
  const path = c.req.query("path");
  try {
    const result = await listDirectory(path);
    return c.json({ ...result, home: homeDir() });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
});

// ─── Sessions ──────────────────────────────────────────────────────────────

const VALID_KINDS = new Set<CreateSessionRequest["kind"]>([
  "tracked_task",
  "freeform",
  "pr_verification",
]);

app.post("/api/sessions", async (c) => {
  let body: CreateSessionRequest;
  try {
    body = (await c.req.json()) as CreateSessionRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object" || !VALID_KINDS.has(body.kind)) {
    return c.json(
      { error: "kind must be one of tracked_task | freeform | pr_verification" },
      400,
    );
  }
  if (body.repoPath) {
    try {
      await validateRepoPath(body.repoPath);
    } catch (err) {
      return c.json(
        { error: String(err instanceof Error ? err.message : err) },
        400,
      );
    }
  }
  const session = await createSession(body);
  log.info("sessions", "created", {
    id: session.id,
    kind: session.kind,
    hasWorktree: !!session.worktreePath,
  });
  broadcast({ type: "session_created", session });

  // Auto-start Codex. Best-effort: failures here don't fail session
  // creation — the user can retry from the session view. If the session
  // was created with a prompt, send it as the first turn so the user's
  // initial message gets a reply (without it the prompt only lives in
  // Codex's base instructions and goes unanswered).
  void (async () => {
    try {
      await startAgent(session.id);
      if (session.prompt && session.prompt.trim().length > 0) {
        await sendUserMessage(session.id, session.prompt);
      }
    } catch (err) {
      log.warn("sessions", "auto-start or initial prompt failed", {
        sessionId: session.id,
        err: String(err instanceof Error ? err.message : err),
      });
    }
  })();

  const response: CreateSessionResponse = { session };
  return c.json(response, 201);
});

app.get("/api/sessions", (c) => {
  const sessions = listSessions(50);
  const response: ListSessionsResponse = { sessions };
  return c.json(response);
});

app.get("/api/sessions/:id", (c) => {
  const id = c.req.param("id");
  const session = getSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  const response: GetSessionResponse = { session };
  return c.json(response);
});

app.post("/api/sessions/:id/allow-command", async (c) => {
  const id = c.req.param("id");
  let body: { binary?: string };
  try {
    body = (await c.req.json()) as { binary?: string };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.binary || typeof body.binary !== "string") {
    return c.json({ error: "binary is required" }, 400);
  }
  const session = allowCommand(id, body.binary);
  if (!session) return c.json({ error: "session not found" }, 404);
  broadcast({ type: "session_updated", session });
  return c.json({ session });
});

app.delete("/api/sessions/:id/allow-command/:binary", (c) => {
  const id = c.req.param("id");
  const binary = c.req.param("binary");
  const session = disallowCommand(id, binary);
  if (!session) return c.json({ error: "session not found" }, 404);
  broadcast({ type: "session_updated", session });
  return c.json({ session });
});

app.post("/api/sessions/:id/sandbox", async (c) => {
  const id = c.req.param("id");
  let body: { sandbox?: Sandbox };
  try {
    body = (await c.req.json()) as { sandbox?: Sandbox };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.sandbox || !VALID_SANDBOXES.has(body.sandbox)) {
    return c.json({ error: "sandbox must be a valid Sandbox" }, 400);
  }
  let session;
  try {
    session = setSessionSandbox(id, body.sandbox);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
  if (!session) return c.json({ error: "session not found" }, 404);
  broadcast({ type: "session_updated", session });
  // Restart Codex so the new sandbox takes effect.
  if (isAgentRunning(id)) {
    await stopAgent(id);
    void startAgent(id).catch((err) => {
      log.warn("sessions", "restart after sandbox change failed", {
        sessionId: id,
        err: String(err instanceof Error ? err.message : err),
      });
    });
  }
  return c.json({ session });
});

app.post("/api/sessions/:id/model", async (c) => {
  const id = c.req.param("id");
  let body: { model?: string | null };
  try {
    body = (await c.req.json()) as { model?: string | null };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const model = body.model === null ? null : (body.model ?? "").trim();
  if (model !== null && model.length === 0) {
    return c.json({ error: "model must be a non-empty string or null" }, 400);
  }
  const session = setSessionModel(id, model);
  if (!session) return c.json({ error: "session not found" }, 404);
  broadcast({ type: "session_updated", session });
  if (isAgentRunning(id)) {
    await stopAgent(id);
    void startAgent(id).catch((err) => {
      log.warn("sessions", "restart after model change failed", {
        sessionId: id,
        err: String(err instanceof Error ? err.message : err),
      });
    });
  }
  return c.json({ session });
});

app.post("/api/sessions/:id/think", async (c) => {
  const id = c.req.param("id");
  let body: { effort?: string | null };
  try {
    body = (await c.req.json()) as { effort?: string | null };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const raw = body.effort;
  if (
    raw !== null &&
    raw !== "low" &&
    raw !== "medium" &&
    raw !== "high"
  ) {
    return c.json({ error: "effort must be one of low | medium | high | null" }, 400);
  }
  let session;
  try {
    session = setSessionReasoningEffort(id, raw as "low" | "medium" | "high" | null);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
  if (!session) return c.json({ error: "session not found" }, 404);
  broadcast({ type: "session_updated", session });
  if (isAgentRunning(id)) {
    await stopAgent(id);
    void startAgent(id).catch((err) => {
      log.warn("sessions", "restart after think change failed", {
        sessionId: id,
        err: String(err instanceof Error ? err.message : err),
      });
    });
  }
  return c.json({ session });
});

app.post("/api/sessions/:id/agent/restart", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (isAgentRunning(sessionId)) {
    await stopAgent(sessionId);
  }
  try {
    const { threadId } = await startAgent(sessionId);
    return c.json({ threadId });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.post("/api/sessions/:id/agent/clear", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (isAgentRunning(sessionId)) {
    await stopAgent(sessionId);
  }
  await archiveAgentHistory(sessionId);
  try {
    const { threadId } = await startAgent(sessionId);
    return c.json({ threadId });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.post("/api/sessions/:id/auto-approve", async (c) => {
  const id = c.req.param("id");
  let body: { enabled?: boolean };
  try {
    body = (await c.req.json()) as { enabled?: boolean };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.enabled !== "boolean") {
    return c.json({ error: "enabled must be boolean" }, 400);
  }
  const session = setSessionAutoApprove(id, body.enabled);
  if (!session) return c.json({ error: "session not found" }, 404);
  broadcast({ type: "session_updated", session });
  // Codex sets approval_policy at thread/start time. If the agent is
  // currently running, the policy is baked in for this thread; restart
  // so the new setting takes effect.
  if (isAgentRunning(id)) {
    await stopAgent(id);
    void startAgent(id).catch((err) => {
      log.warn("sessions", "restart after auto-approve toggle failed", {
        sessionId: id,
        err: String(err instanceof Error ? err.message : err),
      });
    });
  }
  return c.json({ session });
});

app.delete("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const session = getSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (isAgentRunning(id)) {
    await stopAgent(id);
  }
  const ok = await deleteSession(id);
  if (!ok) return c.json({ error: "delete failed" }, 500);
  broadcast({ type: "session_deleted", sessionId: id });
  return c.json({ ok: true });
});

app.post("/api/sessions/:id/attach-repo", async (c) => {
  const sessionId = c.req.param("id");
  let body: { repoPath?: string };
  try {
    body = (await c.req.json()) as { repoPath?: string };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.repoPath || typeof body.repoPath !== "string") {
    return c.json({ error: "repoPath is required" }, 400);
  }
  try {
    const session = await attachRepo(sessionId, body.repoPath);
    broadcast({ type: "session_updated", session });

    // If Codex is running, restart it so the new cwd + baseInstructions
    // take effect immediately.
    if (isAgentRunning(sessionId)) {
      await stopAgent(sessionId);
    }
    void startAgent(sessionId).catch((err) => {
      log.warn("sessions", "restart after attach failed", {
        sessionId,
        err: String(err instanceof Error ? err.message : err),
      });
    });

    return c.json({ session });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
});

app.get("/api/sessions/:id/verification", (c) => {
  const id = c.req.param("id");
  const session = getSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  return c.json({ results: getLatestResults(id) });
});

app.get("/api/sessions/:id/profile", async (c) => {
  const id = c.req.param("id");
  const session = getSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.repoPath) {
    const response: GetProfileResponse = {
      result: {
        profile: null,
        path: "",
        found: false,
        error: null,
      },
    };
    return c.json(response);
  }
  const result = await loadProfile(session.repoPath);
  const response: GetProfileResponse = { result };
  return c.json(response);
});

// ─── Runs ──────────────────────────────────────────────────────────────────

const VALID_RUN_KINDS: ReadonlySet<RunKind> = new Set<RunKind>([
  "reproduce",
  "verify",
  "evaluate",
  "train",
  "render",
  "shell",
  "agent",
]);

function splitCommand(input: string | string[]): string[] {
  if (Array.isArray(input)) return input.filter((x) => x.length > 0);
  return input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

app.get("/api/sessions/:id/runs", (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  const runs = listRunsBySession(sessionId);
  const response: ListRunsResponse = { runs };
  return c.json(response);
});

app.post("/api/sessions/:id/runs", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);

  let body: CreateRunRequest;
  try {
    body = (await c.req.json()) as CreateRunRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object" || body.command === undefined) {
    return c.json({ error: "command is required" }, 400);
  }
  const command = splitCommand(body.command);
  if (command.length === 0) {
    return c.json({ error: "command is empty" }, 400);
  }
  const kind: RunKind = body.kind ?? "shell";
  if (!VALID_RUN_KINDS.has(kind)) {
    return c.json(
      {
        error: `kind must be one of: ${[...VALID_RUN_KINDS].join(" | ")}`,
      },
      400,
    );
  }
  try {
    const run = await startRun({ sessionId, command, kind });
    const response: CreateRunResponse = { run };
    return c.json(response, 201);
  } catch (err) {
    log.error("api", "run start failed", {
      sessionId,
      err: String(err instanceof Error ? err.message : err),
    });
    return c.json({ error: String(err) }, 500);
  }
});

app.get("/api/runs/:id", async (c) => {
  const id = c.req.param("id");
  const run = getRun(id);
  if (!run) return c.json({ error: "run not found" }, 404);
  const includeLogs = c.req.query("logs") === "1";
  const response: GetRunResponse = {
    run,
    logs: includeLogs
      ? (await readRunEvents(id)).map((e) => ({
          runId: e.runId,
          stream: e.stream,
          t: e.t,
          message: e.message,
        }))
      : undefined,
  };
  return c.json(response);
});

app.post("/api/sessions/:id/scenarios/:name/run", async (c) => {
  const sessionId = c.req.param("id");
  const name = c.req.param("name");
  try {
    const outcome = await runScenario({ sessionId, scenarioName: name });
    const response: RunScenarioResponse = outcome;
    return c.json(response, 201);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
});

app.get("/api/runs/:id/artifacts", async (c) => {
  const id = c.req.param("id");
  const run = getRun(id);
  if (!run) return c.json({ error: "run not found" }, 404);
  const list = await listRunArtifacts(run);
  return c.json({ artifacts: list });
});

app.get("/api/runs/:id/artifacts/:name", async (c) => {
  const id = c.req.param("id");
  const name = c.req.param("name");
  const run = getRun(id);
  if (!run) return c.json({ error: "run not found" }, 404);
  // Reject any path traversal — only flat filenames inside the run dir.
  if (name.includes("/") || name.includes("..") || name.startsWith(".")) {
    return c.json({ error: "invalid name" }, 400);
  }
  const filePath = `${run.runDir}/${name}`;
  const file = Bun.file(filePath);
  if (!(await file.exists())) return c.json({ error: "not found" }, 404);
  return new Response(file);
});

app.post("/api/runs/:id/abort", async (c) => {
  const id = c.req.param("id");
  const ok = await abortRun(id);
  if (!ok) return c.json({ error: "run not active" }, 404);
  return c.json({ ok: true });
});

// ─── Agent (Codex) ────────────────────────────────────────────────────────

app.get("/api/sessions/:id/agent/context", async (c) => {
  const id = c.req.param("id");
  const session = getSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  const text = await composeBaseInstructions(session);
  return c.json({ baseInstructions: text });
});

app.get("/api/sessions/:id/agent/history", async (c) => {
  const id = c.req.param("id");
  const session = getSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  const { events } = await readAgentHistory(id);
  return c.json({
    events,
    alive: isAgentRunning(id),
    threadId: session.codexThreadId,
  });
});

const VALID_SANDBOXES: ReadonlySet<Sandbox> = new Set<Sandbox>([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

app.post("/api/sessions/:id/agent/start", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  let body: StartAgentRequest = {};
  try {
    body = (await c.req.json().catch(() => ({}))) as StartAgentRequest;
  } catch {
    body = {};
  }
  if (body.sandbox && !VALID_SANDBOXES.has(body.sandbox)) {
    return c.json({ error: `invalid sandbox: ${body.sandbox}` }, 400);
  }
  try {
    await startAgent(sessionId, { sandbox: body.sandbox });
    const fresh = getSession(sessionId);
    const response: StartAgentResponse = { session: fresh! };
    return c.json(response, 201);
  } catch (err) {
    log.error("api", "agent start failed", {
      sessionId,
      err: String(err instanceof Error ? err.message : err),
    });
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.post("/api/sessions/:id/agent/message", async (c) => {
  const sessionId = c.req.param("id");
  if (!isAgentRunning(sessionId)) {
    return c.json({ error: "agent not running for this session" }, 400);
  }
  let body: AgentMessageRequest;
  try {
    body = (await c.req.json()) as AgentMessageRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body?.prompt || typeof body.prompt !== "string") {
    return c.json({ error: "prompt is required" }, 400);
  }
  try {
    const { turnId } = await sendUserMessage(sessionId, body.prompt);
    const response: AgentMessageResponse = { turnId };
    return c.json(response, 201);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.post("/api/sessions/:id/agent/stop", async (c) => {
  const sessionId = c.req.param("id");
  const ok = await stopAgent(sessionId);
  if (!ok)
    return c.json({ error: "agent not running for this session" }, 404);
  return c.json({ ok: true });
});

// ─── PRs ──────────────────────────────────────────────────────────────────

app.post("/api/sessions/:id/pr/draft", async (c) => {
  const sessionId = c.req.param("id");
  try {
    const draft = await draftPr(sessionId);
    const response: PrDraftResponse = draft;
    return c.json(response);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
});

app.post("/api/sessions/:id/pr/open", async (c) => {
  const sessionId = c.req.param("id");
  let body: OpenPrRequest;
  try {
    body = (await c.req.json()) as OpenPrRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body?.title || !body?.body) {
    return c.json({ error: "title and body are required" }, 400);
  }
  try {
    const result = await openPr(sessionId, body);
    const response: OpenPrResponse = result;
    return c.json(response, 201);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
});

// ─── WebSocket ─────────────────────────────────────────────────────────────

const PING_INTERVAL_MS = 5_000;

app.get(
  "/ws",
  upgradeWebSocket(() => {
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let unregister: (() => void) | null = null;

    return {
      onOpen: (_event, ws) => {
        log.info("ws", "client connected");

        const hello: ServerMessage = {
          type: "hello",
          server: "range",
          version: VERSION,
          serverTime: Date.now(),
        };
        ws.send(JSON.stringify(hello));

        unregister = registerSender((raw) => ws.send(raw));

        pingTimer = setInterval(() => {
          const ping: ServerMessage = { type: "ping", t: Date.now() };
          ws.send(JSON.stringify(ping));
        }, PING_INTERVAL_MS);
      },

      onMessage: (event, _ws) => {
        const raw = event.data;
        if (typeof raw !== "string") return;
        try {
          const msg = JSON.parse(raw) as { type?: string } & Record<string, unknown>;
          log.debug("ws", "message", { type: msg.type });
          if (msg.type === "agent_approval_response") {
            const r = msg as unknown as ClientAgentApprovalResponse;
            const ok = respondToApproval(
              r.sessionId,
              r.requestId,
              r.decision,
            );
            if (!ok) {
              log.warn("ws", "approval response had no pending", {
                sessionId: r.sessionId,
                requestId: r.requestId,
              });
            }
          }
        } catch {
          log.warn("ws", "non-JSON message", { len: raw.length });
        }
      },

      onClose: () => {
        log.info("ws", "client disconnected");
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (unregister) {
          unregister();
          unregister = null;
        }
      },

      onError: (event) => {
        log.error("ws", "socket error", {
          err: String((event as ErrorEvent).message ?? event),
        });
      },
    };
  }),
);

// ─── Static (production) ───────────────────────────────────────────────────

if (Bun.env.RANGE_ENV === "production") {
  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`./dist/web${filePath}`);
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response(Bun.file("./dist/web/index.html"));
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────────

const server = Bun.serve({
  fetch: app.fetch,
  websocket,
  port: PORT,
  hostname: "127.0.0.1",
});

log.info(
  "server",
  `range listening on http://${server.hostname}:${server.port}`,
);

process.on("SIGINT", () => {
  log.info("server", "SIGINT received, stopping");
  server.stop();
  process.exit(0);
});
