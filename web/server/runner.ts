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
  setRunState,
} from "./runs.ts";
import { getSession } from "./sessions.ts";
import { evaluateGatesForRun } from "./verification.ts";
import type {
  LogStream,
  Run,
  RunKind,
  ServerRunLog,
} from "../shared/protocol.ts";

export interface StartRunInput {
  sessionId: string;
  command: string[];
  kind?: RunKind;
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
  });

  broadcast({ type: "run_started", run });
  log.info("runner", "queued", { runId, cwd, command: input.command });

  void runInBackground(run).catch((err) => {
    log.error("runner", "background failed", {
      runId,
      err: String(err instanceof Error ? err.message : err),
    });
  });

  return run;
}

async function runInBackground(initialRun: Run): Promise<void> {
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

  let proc: Subprocess<"ignore", "pipe", "pipe"> | null = null;
  try {
    proc = Bun.spawn(initialRun.command, {
      cwd: initialRun.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
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
