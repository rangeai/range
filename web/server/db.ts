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
