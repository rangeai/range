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
