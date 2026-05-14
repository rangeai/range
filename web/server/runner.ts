/**
 * Local runner — one command at a time inside a session's worktree.
 *
 * Spawns a subprocess, captures stdout/stderr line-by-line, broadcasts
 * events over WS, and persists everything as JSONL in the run's
 * directory so we can replay later.
 */

import type { Subprocess } from "bun";
import { mkdir, appendFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./log.ts";
import { broadcast } from "./hub.ts";
import {
  createRun,
  getRun,
  markRunFinished,
  markRunRunning,
  newRunId,
  setRunMetrics,
  setRunState,
} from "./runs.ts";
import { getSession } from "./sessions.ts";
import { evaluateGatesForRun } from "./verification.ts";
import { readdir, stat } from "node:fs/promises";
import type {
  ArtifactInfo,
  ArtifactKind,
  LogStream,
  MetricsSnapshot,
  Run,
  RunKind,
  ServerRunLog,
} from "../shared/protocol.ts";

export interface StartRunInput {
  sessionId: string;
  command: string[];
  kind?: RunKind;
  /** Extra env vars merged on top of the shell's defaults. */
  env?: Record<string, string>;
  scenarioName?: string;
  sweepId?: string;
  sweepVariant?: Record<string, string | number>;
}

interface RunningRun {
  run: Run;
  proc: Subprocess<"ignore", "pipe", "pipe">;
  abort: AbortController;
}

const active = new Map<string, RunningRun>();

function runDirFor(runId: string): string {
  return join(homedir(), ".range", "runs", runId);
}

function broadcastLog(entry: ServerRunLog) {
  broadcast(entry);
}

async function pipeStream(
  reader: ReadableStream<Uint8Array>,
  runId: string,
  stream: LogStream,
  startedAt: number,
  eventFile: ReturnType<typeof createWriteStream>,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of reader as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const message = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const event: ServerRunLog = {
        type: "run_log",
        runId,
        stream,
        t: Date.now() - startedAt,
        message,
      };
      eventFile.write(JSON.stringify(event) + "\n");
      broadcastLog(event);
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) {
    const event: ServerRunLog = {
      type: "run_log",
      runId,
      stream,
      t: Date.now() - startedAt,
      message: buf,
    };
    eventFile.write(JSON.stringify(event) + "\n");
    broadcastLog(event);
  }
}

export async function startRun(input: StartRunInput): Promise<Run> {
  const session = getSession(input.sessionId);
  if (!session) {
    throw new Error(`session not found: ${input.sessionId}`);
  }
  if (input.command.length === 0) {
    throw new Error("command is empty");
  }

  const cwd = session.worktreePath ?? process.cwd();
  const kind: RunKind = input.kind ?? "shell";
  const runId = newRunId();
  const runDir = runDirFor(runId);
  await mkdir(runDir, { recursive: true });

  const run = createRun({
    sessionId: input.sessionId,
    kind,
    command: input.command,
    cwd,
    runDir,
    scenarioName: input.scenarioName ?? null,
    sweepId: input.sweepId ?? null,
    sweepVariant: input.sweepVariant ?? null,
  });

  broadcast({ type: "run_started", run });
  log.info("runner", "queued", {
    runId,
    cwd,
    command: input.command,
    scenarioName: input.scenarioName,
    sweepId: input.sweepId,
  });

  void runInBackground(run, input.env ?? {}).catch((err) => {
    log.error("runner", "background failed", {
      runId,
      err: String(err instanceof Error ? err.message : err),
    });
  });

  return run;
}

async function runInBackground(
  initialRun: Run,
  extraEnv: Record<string, string>,
): Promise<void> {
  const runId = initialRun.id;
  const eventPath = join(initialRun.runDir, "events.jsonl");
  const eventFile = createWriteStream(eventPath, { flags: "a" });

  const writeSystem = (message: string, t: number) => {
    const event: ServerRunLog = {
      type: "run_log",
      runId,
      stream: "system",
      t,
      message,
    };
    eventFile.write(JSON.stringify(event) + "\n");
    broadcastLog(event);
  };

  const startedAt = Date.now();
  const running = markRunRunning(runId, startedAt);
  if (running) broadcast({ type: "run_started", run: running });

  writeSystem(
    `starting: ${initialRun.command.join(" ")}  (cwd=${initialRun.cwd})`,
    0,
  );

  const metricsFile = join(initialRun.runDir, "metrics.json");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...extraEnv,
    RANGE_RUN_ID: runId,
    RANGE_RUN_DIR: initialRun.runDir,
    RANGE_METRICS_FILE: metricsFile,
  };
  if (initialRun.scenarioName) env.RANGE_SCENARIO = initialRun.scenarioName;
  if (initialRun.sweepId) env.RANGE_SWEEP_ID = initialRun.sweepId;
  if (initialRun.sweepVariant) {
    env.RANGE_SWEEP_VARIANT = JSON.stringify(initialRun.sweepVariant);
  }

  let proc: Subprocess<"ignore", "pipe", "pipe"> | null = null;
  try {
    proc = Bun.spawn(initialRun.command, {
      cwd: initialRun.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeSystem(`spawn failed: ${msg}`, Date.now() - startedAt);
    eventFile.end();
    const finished = markRunFinished(runId, "failed_start", null, Date.now());
    if (finished) broadcast({ type: "run_finished", run: finished });
    return;
  }

  const abort = new AbortController();
  const ctxRun = getRun(runId);
  if (ctxRun) active.set(runId, { run: ctxRun, proc, abort });

  await Promise.all([
    pipeStream(proc.stdout, runId, "stdout", startedAt, eventFile),
    pipeStream(proc.stderr, runId, "stderr", startedAt, eventFile),
  ]);

  const exitCode = await proc.exited;
  const finishedAt = Date.now();
  active.delete(runId);

  const aborted = abort.signal.aborted;
  const state = aborted
    ? "aborted"
    : exitCode === 0
      ? "succeeded"
      : "failed";

  writeSystem(
    `finished: ${state}  (exit=${exitCode}, duration=${finishedAt - startedAt}ms)`,
    finishedAt - startedAt,
  );
  eventFile.end();

  const finished = markRunFinished(
    runId,
    state as Run["state"],
    exitCode,
    finishedAt,
  );
  if (finished) {
    broadcast({ type: "run_finished", run: finished });
    void readAndBroadcastMetrics(finished, metricsFile).catch((err) => {
      log.warn("runner", "metrics read failed", {
        runId,
        err: String(err instanceof Error ? err.message : err),
      });
    });
    void scanAndBroadcastArtifacts(finished).catch((err) => {
      log.warn("runner", "artifact scan failed", {
        runId,
        err: String(err instanceof Error ? err.message : err),
      });
    });
    void evaluateGatesForRun(finished).catch((err) => {
      log.warn("runner", "verification failed", {
        runId,
        err: String(err instanceof Error ? err.message : err),
      });
    });
  }
  log.info("runner", "finished", {
    runId,
    state,
    exitCode,
    durationMs: finishedAt - startedAt,
  });
}

async function readAndBroadcastMetrics(
  run: Run,
  metricsFile: string,
): Promise<void> {
  const f = Bun.file(metricsFile);
  if (!(await f.exists())) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await f.text());
  } catch (err) {
    log.warn("runner", "metrics not valid JSON", {
      runId: run.id,
      err: String(err instanceof Error ? err.message : err),
    });
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const metrics: MetricsSnapshot = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      metrics[k] = v;
    }
  }
  if (Object.keys(metrics).length === 0) return;
  setRunMetrics(run.id, metrics);
  broadcast({
    type: "run_metrics",
    runId: run.id,
    sessionId: run.sessionId,
    metrics,
  });
  log.info("runner", "metrics recorded", {
    runId: run.id,
    keys: Object.keys(metrics),
  });
}

function classifyArtifact(name: string): ArtifactKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".usd") || lower.endsWith(".usda") || lower.endsWith(".usdc"))
    return "usd";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "image";
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return "video";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".npy") || lower.endsWith(".npz")) return "npy";
  if (/\.(obj|ply|gltf|glb|stl|fbx)$/.test(lower)) return "mesh";
  return "other";
}

export async function listRunArtifacts(run: Run): Promise<ArtifactInfo[]> {
  const skip = new Set(["events.jsonl", "metrics.json"]);
  let entries: string[];
  try {
    entries = await readdir(run.runDir);
  } catch {
    return [];
  }
  const artifacts: ArtifactInfo[] = [];
  for (const name of entries) {
    if (skip.has(name) || name.startsWith(".")) continue;
    try {
      const s = await stat(join(run.runDir, name));
      if (!s.isFile()) continue;
      artifacts.push({
        name,
        size: s.size,
        kind: classifyArtifact(name),
      });
    } catch {
      // ignore
    }
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name));
  return artifacts;
}

async function scanAndBroadcastArtifacts(run: Run): Promise<void> {
  const artifacts = await listRunArtifacts(run);
  if (artifacts.length === 0) return;
  broadcast({
    type: "run_artifacts",
    runId: run.id,
    sessionId: run.sessionId,
    artifacts,
  });
  log.info("runner", "artifacts recorded", {
    runId: run.id,
    count: artifacts.length,
  });
}

export async function abortRun(runId: string): Promise<boolean> {
  const r = active.get(runId);
  if (!r) return false;
  r.abort.abort();
  try {
    r.proc.kill();
  } catch (err) {
    log.warn("runner", "kill threw", { runId, err: String(err) });
  }
  setRunState(runId, "aborted");
  return true;
}

export async function readRunEvents(
  runId: string,
  maxBytes = 256 * 1024,
): Promise<ServerRunLog[]> {
  const run = getRun(runId);
  if (!run) return [];
  const path = join(run.runDir, "events.jsonl");
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return [];
    const size = file.size;
    const start = Math.max(0, size - maxBytes);
    const slice = file.slice(start, size);
    const text = await slice.text();
    const lines = text.split("\n").filter(Boolean);
    if (start > 0 && lines.length > 0) lines.shift();
    const out: ServerRunLog[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ServerRunLog;
        if (parsed.type === "run_log") out.push(parsed);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch (err) {
    log.warn("runner", "readRunEvents failed", {
      runId,
      err: String(err),
    });
    return [];
  }
}

void appendFile;
