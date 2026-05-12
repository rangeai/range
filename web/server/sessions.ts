/**
 * Session storage + queries. Backed by SQLite via db.ts.
 *
 * All times are unix millis (`Date.now()`).
 * IDs use a short base36 timestamp + random suffix; unique enough for a
 * single-machine MVP, replaceable with ulid/uuid if needed.
 */

import { db } from "./db.ts";
import { isGitRepo } from "./worktree.ts";
import type {
  CreateSessionRequest,
  Session,
  SessionKind,
} from "../shared/protocol.ts";

interface SessionRow {
  id: string;
  kind: string;
  title: string;
  prompt: string | null;
  repo: string | null;
  repo_path: string | null;
  task_ref: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    kind: row.kind as Session["kind"],
    title: row.title,
    prompt: row.prompt,
    repo: row.repo,
    repoPath: row.repo_path,
    taskRef: row.task_ref,
    status: row.status as Session["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newSessionId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `ssn_${t}${r}`;
}

function defaultTitle(kind: SessionKind, prompt: string | null): string {
  if (prompt && prompt.length > 0) {
    return prompt.length > 80 ? `${prompt.slice(0, 80).trim()}…` : prompt;
  }
  switch (kind) {
    case "tracked_task":
      return "Untitled task";
    case "freeform":
      return "Untitled freeform session";
    case "pr_verification":
      return "Untitled PR verification";
  }
}

const insertStmt = db.prepare(`
  INSERT INTO sessions (
    id, kind, title, prompt, repo, repo_path, task_ref,
    status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
`);

const selectByIdStmt = db.prepare<SessionRow, [string]>(
  "SELECT * FROM sessions WHERE id = ?",
);

const selectListStmt = db.prepare<SessionRow, [number]>(
  "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?",
);

export async function validateRepoPath(repoPath: string): Promise<void> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error(
      `repoPath "${repoPath}" is not a git repository (or does not exist)`,
    );
  }
}

export function createSession(req: CreateSessionRequest): Session {
  const id = newSessionId();
  const now = Date.now();
  const title =
    req.title?.trim() || defaultTitle(req.kind, req.prompt ?? null);
  insertStmt.run(
    id,
    req.kind,
    title,
    req.prompt ?? null,
    req.repo ?? null,
    req.repoPath ?? null,
    req.taskRef ?? null,
    now,
    now,
  );
  return {
    id,
    kind: req.kind,
    title,
    prompt: req.prompt ?? null,
    repo: req.repo ?? null,
    repoPath: req.repoPath ?? null,
    taskRef: req.taskRef ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export function getSession(id: string): Session | null {
  const row = selectByIdStmt.get(id);
  return row ? rowToSession(row) : null;
}

export function listSessions(limit = 50): Session[] {
  return selectListStmt.all(limit).map(rowToSession);
}
