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
import { detectScaffold, writeScaffold } from "./scaffold.ts";
import {
  applyWirePatches,
  detectAndWireWandbHydra,
} from "./wire.ts";
import { readFile, access } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import {
  formatReportForCodex,
  inspectTrajectory,
} from "./trajectory.ts";
import { readNpz } from "./npz.ts";
import { getLatestResults } from "./verification.ts";
import { draftPr, openPr } from "./pr.ts";
import { listDirectory, homeDir } from "./fs_browse.ts";
import { runScenario } from "./scenarios.ts";
// codex.ts and opencode.ts are imported for their side effect of
// registering their respective backends in the agent registry. The
// free-function exports from codex.ts (composeBaseInstructions etc.)
// are still used for Range-side concerns that aren't backend-specific.
import "./codex.ts";
import "./opencode.ts";
import {
  archiveAgentHistory,
  composeBaseInstructions,
  readAgentHistory,
} from "./codex.ts";
import { backendFor, shutdownAllBackends } from "./agent.ts";
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

  // Lazy-start: don't spawn Codex up front. It boots on the first
  // user action (slash builtin, message, etc.) and shuts down after
  // an idle horizon. If the session has an initial prompt, send it
  // now — that triggers the lazy-start and lands the first turn.
  if (session.prompt && session.prompt.trim().length > 0) {
    void backendFor(session.id).sendMessage(session.id, session.prompt).catch((err) => {
      log.warn("sessions", "initial prompt failed", {
        sessionId: session.id,
        err: String(err instanceof Error ? err.message : err),
      });
    });
  }

  // Auto-scaffold: if the session was created with a repo attached (i.e.
  // via the home composer rather than via the separate attach-repo flow),
  // run the same detector pipeline. Mirrors the /attach-repo handler.
  if (session.repoPath) {
    const repoPath = session.repoPath;
    void detectScaffold(repoPath)
      .then((proposal) => {
        if (!proposal) return;
        broadcast({
          type: "scaffold_proposed",
          sessionId: session.id,
          proposal,
          t: Date.now(),
        });
        log.info("sessions", "scaffold proposed", {
          sessionId: session.id,
          stack: proposal.stack,
          proposalId: proposal.proposalId,
        });
      })
      .catch((err) => {
        log.warn("sessions", "scaffold detection failed", {
          sessionId: session.id,
          err: String(err instanceof Error ? err.message : err),
        });
      });
  }

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
  if (backendFor(id).isRunning(id)) {
    await backendFor(id).stop(id);
    void backendFor(id).start(id).catch((err) => {
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
  let body: { model?: string | null; provider?: string | null };
  try {
    body = (await c.req.json()) as {
      model?: string | null;
      provider?: string | null;
    };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const model = body.model === null ? null : (body.model ?? "").trim();
  if (model !== null && model.length === 0) {
    return c.json({ error: "model must be a non-empty string or null" }, 400);
  }
  const provider =
    body.provider === null
      ? null
      : body.provider === undefined
        ? undefined
        : body.provider.trim() || null;
  const session = setSessionModel(id, model, provider);
  if (!session) return c.json({ error: "session not found" }, 404);
  broadcast({ type: "session_updated", session });
  if (backendFor(id).isRunning(id)) {
    await backendFor(id).stop(id);
    void backendFor(id).start(id).catch((err) => {
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
  if (backendFor(id).isRunning(id)) {
    await backendFor(id).stop(id);
    void backendFor(id).start(id).catch((err) => {
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
  if (backendFor(sessionId).isRunning(sessionId)) {
    await backendFor(sessionId).stop(sessionId);
  }
  try {
    const { threadId } = await backendFor(sessionId).start(sessionId);
    return c.json({ threadId });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.post("/api/sessions/:id/agent/compact", async (c) => {
  const sessionId = c.req.param("id");
  const backend = backendFor(sessionId);
  if (!backend.isRunning(sessionId)) {
    return c.json({ error: "agent not running for this session" }, 400);
  }
  if (!backend.features.compact || !backend.compact) {
    return c.json(
      { error: `backend "${backend.name}" does not support compact` },
      400,
    );
  }
  try {
    await backend.compact(sessionId);
    return c.json({ ok: true });
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
  if (backendFor(sessionId).isRunning(sessionId)) {
    await backendFor(sessionId).stop(sessionId);
  }
  await archiveAgentHistory(sessionId);
  try {
    const { threadId } = await backendFor(sessionId).start(sessionId);
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
  if (backendFor(id).isRunning(id)) {
    await backendFor(id).stop(id);
    void backendFor(id).start(id).catch((err) => {
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
  if (backendFor(id).isRunning(id)) {
    await backendFor(id).stop(id);
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
    // take effect immediately. Otherwise leave it asleep — next user
    // action will lazy-start with the new repo state.
    if (backendFor(sessionId).isRunning(sessionId)) {
      await backendFor(sessionId).stop(sessionId);
      void backendFor(sessionId).start(sessionId).catch((err) => {
        log.warn("sessions", "restart after attach failed", {
          sessionId,
          err: String(err instanceof Error ? err.message : err),
        });
      });
    }

    // Auto-scaffold: if the attached repo has no range.yaml but a
    // detector recognizes its shape, offer a proposal in the
    // conversation. Fire-and-forget — failure should not block attach.
    void detectScaffold(body.repoPath)
      .then((proposal) => {
        if (!proposal) return;
        broadcast({
          type: "scaffold_proposed",
          sessionId,
          proposal,
          t: Date.now(),
        });
        log.info("sessions", "scaffold proposed", {
          sessionId,
          stack: proposal.stack,
          proposalId: proposal.proposalId,
        });
      })
      .catch((err) => {
        log.warn("sessions", "scaffold detection failed", {
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

app.post("/api/sessions/:id/scaffold/preview", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.repoPath) return c.json({ error: "session has no repo" }, 400);
  try {
    const proposal = await detectScaffold(session.repoPath);
    if (!proposal) return c.json({ proposal: null });
    broadcast({
      type: "scaffold_proposed",
      sessionId,
      proposal,
      t: Date.now(),
    });
    return c.json({ proposal });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.post("/api/sessions/:id/scaffold/accept", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.repoPath) return c.json({ error: "session has no repo" }, 400);
  let body: { proposalId?: string; yamlText?: string };
  try {
    body = (await c.req.json()) as { proposalId?: string; yamlText?: string };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.proposalId || !body.yamlText) {
    return c.json({ error: "proposalId and yamlText required" }, 400);
  }
  const result = await writeScaffold(session.repoPath, body.yamlText);
  if (!result.written) return c.json({ error: result.error }, 400);

  broadcast({
    type: "scaffold_resolved",
    sessionId,
    proposalId: body.proposalId,
    decision: "accepted",
    t: Date.now(),
  });
  // Nudge clients to re-read the profile.
  broadcast({ type: "session_updated", session });
  return c.json({ ok: true, path: result.path });
});

app.post("/api/sessions/:id/wire/wandb-hydra/preview", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.repoPath) return c.json({ error: "session has no repo" }, 400);
  try {
    const proposal = await detectAndWireWandbHydra(session.repoPath);
    if (!proposal) return c.json({ proposal: null });
    broadcast({
      type: "wire_proposed",
      sessionId,
      proposal,
      t: Date.now(),
    });
    return c.json({ proposal });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.post("/api/sessions/:id/wire/wandb-hydra/accept", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.repoPath) return c.json({ error: "session has no repo" }, 400);
  let body: {
    proposalId?: string;
    patches?: import("../shared/protocol.ts").WirePatch[];
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.proposalId || !Array.isArray(body.patches)) {
    return c.json({ error: "proposalId and patches required" }, 400);
  }
  const result = await applyWirePatches(session.repoPath, body.patches);
  if (result.errors.length > 0) {
    return c.json(
      {
        error: result.errors.join("; "),
        writtenBeforeFailure: result.written,
      },
      400,
    );
  }
  broadcast({
    type: "wire_resolved",
    sessionId,
    proposalId: body.proposalId,
    decision: "accepted",
    t: Date.now(),
  });
  return c.json({ ok: true, written: result.written });
});

app.post("/api/sessions/:id/wire/wandb-hydra/dismiss", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  let body: { proposalId?: string };
  try {
    body = (await c.req.json()) as { proposalId?: string };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.proposalId) return c.json({ error: "proposalId required" }, 400);
  broadcast({
    type: "wire_resolved",
    sessionId,
    proposalId: body.proposalId,
    decision: "dismissed",
    t: Date.now(),
  });
  return c.json({ ok: true });
});

app.post("/api/sessions/:id/scaffold/dismiss", async (c) => {
  const sessionId = c.req.param("id");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  let body: { proposalId?: string };
  try {
    body = (await c.req.json()) as { proposalId?: string };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.proposalId) return c.json({ error: "proposalId required" }, 400);
  broadcast({
    type: "scaffold_resolved",
    sessionId,
    proposalId: body.proposalId,
    decision: "dismissed",
    t: Date.now(),
  });
  return c.json({ ok: true });
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

// /eval — run a scenario with RANGE_CHECKPOINT injected so the
// user's training script knows to load weights instead of training
// from scratch. The convention for picking up the env var is up to
// the user's script.
app.post("/api/sessions/:id/eval", async (c) => {
  const sessionId = c.req.param("id");
  let body: { checkpoint?: string; scenario?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.checkpoint || typeof body.checkpoint !== "string") {
    return c.json({ error: "checkpoint path required" }, 400);
  }
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.repoPath)
    return c.json({ error: "session has no repo attached" }, 400);

  // If no scenario specified, pick the first scenario from the profile.
  let scenarioName = body.scenario;
  if (!scenarioName) {
    const profileResult = await loadProfile(session.repoPath);
    const profile = profileResult.profile;
    if (!profile || profile.scenarios.length === 0) {
      return c.json(
        { error: "no scenarios in range.yaml — pass `scenario` explicitly" },
        400,
      );
    }
    scenarioName = profile.scenarios[0]!.name;
  }
  try {
    const outcome = await runScenario({
      sessionId,
      scenarioName,
      extraEnv: { RANGE_CHECKPOINT: body.checkpoint },
    });
    return c.json(outcome, 201);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
});

// /reward show — return the source text of a reward function by
// name (matched against profile.reward_functions). Used by the
// slash builtin to surface the implementation inline.
app.get("/api/sessions/:id/reward/:name", async (c) => {
  const sessionId = c.req.param("id");
  const name = c.req.param("name");
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.repoPath)
    return c.json({ error: "session has no repo" }, 400);
  const profileResult = await loadProfile(session.repoPath);
  const profile = profileResult.profile;
  if (!profile) return c.json({ error: "no range.yaml profile" }, 400);
  const reward = profile.rewardFunctions.find((r) => r.name === name);
  if (!reward) return c.json({ error: `reward function "${name}" not found` }, 404);

  const filePath = pathJoin(session.repoPath, reward.file);
  try {
    await access(filePath);
  } catch {
    return c.json({ error: `file not found: ${reward.file}` }, 404);
  }
  const text = await readFile(filePath, "utf8");
  // Extract just the function body (and its docstring if any) for
  // display. We grep for `def <function>(` and walk until the next
  // top-level def or end of file.
  const source = extractPyFunction(text, reward.function);
  return c.json({
    name: reward.name,
    file: reward.file,
    function: reward.function,
    description: reward.description ?? null,
    source: source ?? text,
    extracted: source !== null,
  });
});

function extractPyFunction(text: string, fnName: string): string | null {
  const lines = text.split("\n");
  const startRe = new RegExp(`^(\\s*)def\\s+${fnName}\\s*\\(`);
  let startIdx = -1;
  let baseIndent = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(startRe);
    if (m) {
      startIdx = i;
      baseIndent = m[1] ?? "";
      break;
    }
  }
  if (startIdx < 0) return null;
  // Skip through a multi-line signature: balance the parens that
  // started in the def line. The body begins on the first line after
  // the closing `)`.
  let signatureEnd = startIdx;
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    for (const c of line) {
      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
    }
    signatureEnd = i;
    if (parenDepth === 0 && i > startIdx) {
      bodyStart = i + 1;
      break;
    }
    if (parenDepth === 0 && line.includes(":")) {
      bodyStart = i + 1;
      break;
    }
  }
  if (bodyStart < 0) bodyStart = signatureEnd + 1;

  let endIdx = lines.length;
  for (let j = bodyStart; j < lines.length; j++) {
    const line = lines[j]!;
    if (line.trim().length === 0) continue;
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1]! : "";
    if (indent.length <= baseIndent.length && /\S/.test(line)) {
      endIdx = j;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

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

app.get("/api/runs/:id/trajectory", async (c) => {
  const id = c.req.param("id");
  const run = getRun(id);
  if (!run) return c.json({ error: "run not found" }, 404);
  const maxPoints = Math.max(
    100,
    Math.min(20000, Number(c.req.query("maxPoints") ?? 2000)),
  );
  const npzPath = `${run.runDir}/trajectory.npz`;
  const file = Bun.file(npzPath);
  if (!(await file.exists())) {
    return c.json(
      { error: `no trajectory.npz at ${npzPath}` },
      404,
    );
  }
  try {
    const payload = await readNpz(npzPath, maxPoints);
    return c.json(payload);
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      500,
    );
  }
});

app.get("/api/runs/:id/observation", async (c) => {
  const id = c.req.param("id");
  const run = getRun(id);
  if (!run) return c.json({ error: "run not found" }, 404);
  const stepParam = c.req.query("step");
  const step = Number(stepParam);
  if (!Number.isFinite(step) || step < 0) {
    return c.json({ error: "step must be a non-negative integer" }, 400);
  }
  const eventsPath = `${run.runDir}/events.jsonl`;
  const file = Bun.file(eventsPath);
  if (!(await file.exists())) {
    return c.json({ error: `no events.jsonl at ${eventsPath}` }, 404);
  }
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.length > 0);
  // Walk trajectory ticks (skip Range's own run_log events) and pick
  // the Nth one. Same heuristic the trajectory inspector uses.
  let tickIdx = 0;
  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      // Tolerate Python's NaN/Infinity literals.
      obj = JSON.parse(
        line.replace(/\b(NaN|-Infinity|Infinity)\b/g, "null"),
      ) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof obj.t !== "number" || !Array.isArray(obj.pose)) continue;
    if (tickIdx === step) {
      return c.json({ step, observation: obj });
    }
    tickIdx++;
  }
  return c.json(
    { error: `step ${step} out of range (only ${tickIdx} ticks found)` },
    404,
  );
});

app.get("/api/runs/:id/trajectory/inspect", async (c) => {
  const id = c.req.param("id");
  const run = getRun(id);
  if (!run) return c.json({ error: "run not found" }, 404);
  try {
    const report = await inspectTrajectory(id);
    const promptBlock = formatReportForCodex(report, run.scenarioName ?? null);
    return c.json({ report, promptBlock });
  } catch (err) {
    return c.json(
      { error: String(err instanceof Error ? err.message : err) },
      400,
    );
  }
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
    alive: backendFor(id).isRunning(id),
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
    await backendFor(sessionId).start(sessionId, { sandbox: body.sandbox });
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
    // sendUserMessage handles lazy-start if Codex isn't running yet.
    const { turnId } = await backendFor(sessionId).sendMessage(sessionId, body.prompt);
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
  const ok = await backendFor(sessionId).stop(sessionId);
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
            const ok = backendFor(r.sessionId).respondToApproval(
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

function shutdown(reason: string): never {
  log.info("server", `${reason} received, stopping`);
  // Synchronously SIGKILL every spawned agent child so we don't leak
  // processes on exit. Hot-reload (bun --hot) doesn't re-run module
  // top-level, so the only reap path is here. Calls every registered
  // backend's shutdownAll.
  try {
    shutdownAllBackends();
  } catch (err) {
    log.warn("server", "shutdownAllBackends failed during shutdown", {
      err: String(err instanceof Error ? err.message : err),
    });
  }
  server.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
