/**
 * Run storage. A run is one execution of a command inside a session.
 *
 * Logs are persisted to the filesystem (`run_dir/events.jsonl`); SQLite
 * stores metadata only (state, exit code, timestamps, command).
 */

import { db } from "./db.ts";
import type {
  MetricsSnapshot,
  Run,
  RunKind,
  RunState,
} from "../shared/protocol.ts";

interface RunRow {
  id: string;
  session_id: string;
  kind: string;
  command: string;
  cwd: string;
  state: string;
  exit_code: number | null;
  started_at: number | null;
  finished_at: number | null;
  run_dir: string;
  scenario_name: string | null;
  sweep_id: string | null;
  sweep_variant: string | null;
  metrics: string | null;
  created_at: number;
  updated_at: number;
}

function rowToRun(row: RunRow): Run {
  let command: string[];
  try {
    command = JSON.parse(row.command);
    if (!Array.isArray(command)) command = [String(command)];
  } catch {
    command = [row.command];
  }
  let sweepVariant: Record<string, string | number> | null = null;
  if (row.sweep_variant) {
    try {
      sweepVariant = JSON.parse(row.sweep_variant);
    } catch {
      sweepVariant = null;
    }
  }
  let metrics: MetricsSnapshot | null = null;
  if (row.metrics) {
    try {
      metrics = JSON.parse(row.metrics);
    } catch {
      metrics = null;
    }
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind as RunKind,
    command,
    cwd: row.cwd,
    state: row.state as RunState,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    runDir: row.run_dir,
    scenarioName: row.scenario_name,
    sweepId: row.sweep_id,
    sweepVariant,
    metrics,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function newRunId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `run_${t}${r}`;
}

const insertStmt = db.prepare(`
  INSERT INTO runs (
    id, session_id, kind, command, cwd, state,
    run_dir, scenario_name, sweep_id, sweep_variant,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
`);

const updateMetricsStmt = db.prepare(`
  UPDATE runs SET metrics = ?, updated_at = ? WHERE id = ?
`);

const selectByIdStmt = db.prepare<RunRow, [string]>(
  "SELECT * FROM runs WHERE id = ?",
);

const selectBySessionStmt = db.prepare<RunRow, [string]>(
  "SELECT * FROM runs WHERE session_id = ? ORDER BY created_at ASC",
);

const updateStateStmt = db.prepare(`
  UPDATE runs SET state = ?, updated_at = ? WHERE id = ?
`);

const updateStateWithStartStmt = db.prepare(`
  UPDATE runs SET state = ?, started_at = ?, updated_at = ? WHERE id = ?
`);

const updateStateWithFinishStmt = db.prepare(`
  UPDATE runs SET state = ?, exit_code = ?, finished_at = ?, updated_at = ?
  WHERE id = ?
`);

export interface CreateRunInput {
  sessionId: string;
  kind: RunKind;
  command: string[];
  cwd: string;
  runDir: string;
  scenarioName?: string | null;
  sweepId?: string | null;
  sweepVariant?: Record<string, string | number> | null;
}

export function createRun(input: CreateRunInput): Run {
  const id = newRunId();
  const now = Date.now();
  insertStmt.run(
    id,
    input.sessionId,
    input.kind,
    JSON.stringify(input.command),
    input.cwd,
    input.runDir,
    input.scenarioName ?? null,
    input.sweepId ?? null,
    input.sweepVariant ? JSON.stringify(input.sweepVariant) : null,
    now,
    now,
  );
  const row = selectByIdStmt.get(id);
  if (!row) throw new Error("inserted run not found");
  return rowToRun(row);
}

export function setRunMetrics(
  id: string,
  metrics: MetricsSnapshot,
): Run | null {
  updateMetricsStmt.run(JSON.stringify(metrics), Date.now(), id);
  return getRun(id);
}

export function getRun(id: string): Run | null {
  const row = selectByIdStmt.get(id);
  return row ? rowToRun(row) : null;
}

export function listRunsBySession(sessionId: string): Run[] {
  return selectBySessionStmt.all(sessionId).map(rowToRun);
}

export function markRunRunning(id: string, startedAt: number): Run | null {
  updateStateWithStartStmt.run("running", startedAt, Date.now(), id);
  return getRun(id);
}

export function markRunFinished(
  id: string,
  state: RunState,
  exitCode: number | null,
  finishedAt: number,
): Run | null {
  updateStateWithFinishStmt.run(state, exitCode, finishedAt, Date.now(), id);
  return getRun(id);
}

export function setRunState(id: string, state: RunState): Run | null {
  updateStateStmt.run(state, Date.now(), id);
  return getRun(id);
}
