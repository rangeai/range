/**
 * SQLite storage layer. Uses bun:sqlite (the fastest JS SQLite binding).
 *
 * Database lives at ~/.range/range.db (override via RANGE_DB env).
 * Schema is applied on first open via a tiny embedded migration list.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { log } from "./log.ts";

function resolveDbPath(): string {
  const override = Bun.env.RANGE_DB;
  if (override && override.length > 0) return override;
  return join(homedir(), ".range", "range.db");
}

const DB_PATH = resolveDbPath();
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA synchronous = NORMAL;");

// ─── Migrations ────────────────────────────────────────────────────────────

interface Migration {
  id: number;
  name: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "init_sessions",
    up: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('tracked_task', 'freeform', 'pr_verification')),
        title TEXT NOT NULL,
        prompt TEXT,
        repo TEXT,
        task_ref TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_status_updated ON sessions(status, updated_at DESC);
    `,
  },
  {
    id: 2,
    name: "sessions_add_repo_path",
    up: `
      ALTER TABLE sessions ADD COLUMN repo_path TEXT;
    `,
  },
  {
    id: 3,
    name: "init_attempts",
    up: `
      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'baseline', 'investigation', 'implementation', 'verification', 'freeform'
        )),
        state TEXT NOT NULL DEFAULT 'created' CHECK (state IN (
          'created', 'worktree_ready', 'agent_running', 'waiting_for_user',
          'running_command', 'paused', 'verification_pending',
          'verification_passed', 'verification_failed', 'review_ready',
          'pr_opened', 'archived'
        )),
        sandbox TEXT NOT NULL DEFAULT 'read-only' CHECK (sandbox IN (
          'read-only', 'workspace-write', 'danger-full-access'
        )),
        worktree_path TEXT,
        branch TEXT,
        base_sha TEXT,
        is_candidate INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (session_id, name)
      );
      CREATE INDEX idx_attempts_session ON attempts(session_id, created_at DESC);
    `,
  },
  {
    id: 4,
    name: "init_runs",
    up: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN (
          'reproduce', 'verify', 'evaluate', 'train', 'render', 'shell', 'agent'
        )),
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
          'queued', 'starting', 'running', 'paused',
          'succeeded', 'failed', 'aborted', 'failed_start'
        )),
        exit_code INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        run_dir TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_runs_attempt ON runs(attempt_id, created_at DESC);
    `,
  },
  {
    id: 5,
    name: "attempts_add_codex_thread_id",
    up: `
      ALTER TABLE attempts ADD COLUMN codex_thread_id TEXT;
    `,
  },
  {
    id: 6,
    name: "collapse_attempts_into_sessions",
    up: `
      ALTER TABLE sessions ADD COLUMN worktree_path TEXT;
      ALTER TABLE sessions ADD COLUMN branch TEXT;
      ALTER TABLE sessions ADD COLUMN base_sha TEXT;
      ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT;
      ALTER TABLE sessions ADD COLUMN sandbox TEXT NOT NULL DEFAULT 'read-only';

      UPDATE sessions
      SET
        worktree_path = (
          SELECT worktree_path FROM attempts
          WHERE attempts.session_id = sessions.id
          ORDER BY created_at ASC LIMIT 1
        ),
        branch = (
          SELECT branch FROM attempts
          WHERE attempts.session_id = sessions.id
          ORDER BY created_at ASC LIMIT 1
        ),
        base_sha = (
          SELECT base_sha FROM attempts
          WHERE attempts.session_id = sessions.id
          ORDER BY created_at ASC LIMIT 1
        ),
        codex_thread_id = (
          SELECT codex_thread_id FROM attempts
          WHERE attempts.session_id = sessions.id
          ORDER BY created_at ASC LIMIT 1
        ),
        sandbox = COALESCE((
          SELECT sandbox FROM attempts
          WHERE attempts.session_id = sessions.id
          ORDER BY created_at ASC LIMIT 1
        ), 'read-only')
      WHERE EXISTS (
        SELECT 1 FROM attempts WHERE attempts.session_id = sessions.id
      );

      ALTER TABLE runs ADD COLUMN session_id TEXT;
      UPDATE runs SET session_id = (
        SELECT session_id FROM attempts WHERE attempts.id = runs.attempt_id
      );

      CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, created_at DESC);
    `,
  },
  {
    id: 7,
    name: "runs_attempt_id_nullable_and_session_id_required",
    up: `
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        attempt_id TEXT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN (
          'reproduce', 'verify', 'evaluate', 'train', 'render', 'shell', 'agent'
        )),
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
          'queued', 'starting', 'running', 'paused',
          'succeeded', 'failed', 'aborted', 'failed_start'
        )),
        exit_code INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        run_dir TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO runs_new (
        id, attempt_id, session_id, kind, command, cwd, state,
        exit_code, started_at, finished_at, run_dir, created_at, updated_at
      )
      SELECT
        r.id, r.attempt_id, COALESCE(r.session_id, a.session_id),
        r.kind, r.command, r.cwd, r.state,
        r.exit_code, r.started_at, r.finished_at, r.run_dir,
        r.created_at, r.updated_at
      FROM runs r
      LEFT JOIN attempts a ON a.id = r.attempt_id;

      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
      CREATE INDEX idx_runs_session ON runs(session_id, created_at DESC);
    `,
  },
  {
    id: 8,
    name: "runs_scenarios_and_metrics",
    up: `
      ALTER TABLE runs ADD COLUMN scenario_name TEXT;
      ALTER TABLE runs ADD COLUMN sweep_id TEXT;
      ALTER TABLE runs ADD COLUMN sweep_variant TEXT;
      ALTER TABLE runs ADD COLUMN metrics TEXT;
      CREATE INDEX IF NOT EXISTS idx_runs_sweep ON runs(sweep_id);
    `,
  },
];

function applyMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    (
      db.query<{ id: number }, []>("SELECT id FROM _migrations").all()
    ).map((row) => row.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    log.info("db", "applying migration", { id: m.id, name: m.name });
    const tx = db.transaction(() => {
      db.exec(m.up);
      db.run(
        "INSERT INTO _migrations(id, name, applied_at) VALUES (?, ?, ?)",
        [m.id, m.name, Date.now()],
      );
    });
    tx();
  }
}

applyMigrations();

log.info("db", "ready", { path: DB_PATH });
