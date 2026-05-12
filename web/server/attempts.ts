/**
 * Attempt storage + lifecycle.
 *
 * Backed by SQLite. An attempt is the isolated branch of work inside a
 * session. If the session has a `repo_path`, the attempt gets a real
 * git worktree. Otherwise it is metadata-only for now.
 */

import { db } from "./db.ts";
import { log } from "./log.ts";
import {
  branchNameFor,
  createWorktree,
  worktreePathFor,
} from "./worktree.ts";
import type {
  Attempt,
  AttemptKind,
  AttemptState,
  Sandbox,
} from "../shared/protocol.ts";

interface AttemptRow {
  id: string;
  session_id: string;
  name: string;
  kind: string;
  state: string;
  sandbox: string;
  worktree_path: string | null;
  branch: string | null;
  base_sha: string | null;
  is_candidate: number;
  created_at: number;
  updated_at: number;
}

function rowToAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    kind: row.kind as AttemptKind,
    state: row.state as AttemptState,
    sandbox: row.sandbox as Sandbox,
    worktreePath: row.worktree_path,
    branch: row.branch,
    baseSha: row.base_sha,
    isCandidate: row.is_candidate === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newAttemptId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `att_${t}${r}`;
}

function defaultNameFor(
  kind: AttemptKind,
  existingCount: number,
): string {
  if (existingCount === 0) {
    switch (kind) {
      case "baseline":
        return "baseline-main";
      case "investigation":
        return "codex-investigate";
      case "implementation":
        return "codex-fix-minimal";
      case "verification":
        return "verify";
      case "freeform":
        return "freeform-1";
    }
  }
  return `${kind}-${existingCount + 1}`;
}

const insertStmt = db.prepare(`
  INSERT INTO attempts (
    id, session_id, name, kind, state, sandbox,
    worktree_path, branch, base_sha, is_candidate,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
`);

const selectByIdStmt = db.prepare<AttemptRow, [string]>(
  "SELECT * FROM attempts WHERE id = ?",
);

const selectBySessionStmt = db.prepare<AttemptRow, [string]>(
  "SELECT * FROM attempts WHERE session_id = ? ORDER BY created_at ASC",
);

const countBySessionStmt = db.prepare<{ c: number }, [string]>(
  "SELECT COUNT(*) AS c FROM attempts WHERE session_id = ?",
);

const sessionRepoPathStmt = db.prepare<
  { repo_path: string | null },
  [string]
>("SELECT repo_path FROM sessions WHERE id = ?");

const updateStateStmt = db.prepare(`
  UPDATE attempts SET state = ?, updated_at = ? WHERE id = ?
`);

const setCandidateStmt = db.prepare(`
  UPDATE attempts SET is_candidate = ?, updated_at = ? WHERE id = ?
`);

const clearOtherCandidatesStmt = db.prepare(`
  UPDATE attempts SET is_candidate = 0, updated_at = ?
  WHERE session_id = ? AND id != ?
`);

export interface CreateAttemptInput {
  sessionId: string;
  name?: string;
  kind?: AttemptKind;
  sandbox?: Sandbox;
  baseBranch?: string;
}

export async function createAttempt(
  input: CreateAttemptInput,
): Promise<Attempt> {
  const sessionRow = sessionRepoPathStmt.get(input.sessionId);
  if (!sessionRow) {
    throw new Error(`session not found: ${input.sessionId}`);
  }

  const kind: AttemptKind = input.kind ?? "freeform";
  const sandbox: Sandbox = input.sandbox ?? "read-only";

  const existingCount =
    countBySessionStmt.get(input.sessionId)?.c ?? 0;
  const name = input.name?.trim() || defaultNameFor(kind, existingCount);

  const id = newAttemptId();
  const now = Date.now();

  let worktreePath: string | null = null;
  let branch: string | null = null;
  let baseSha: string | null = null;
  let state: AttemptState = "created";

  if (sessionRow.repo_path) {
    try {
      const wt = await createWorktree({
        repoPath: sessionRow.repo_path,
        sessionId: input.sessionId,
        attemptName: name,
        baseBranch: input.baseBranch,
      });
      worktreePath = wt.path;
      branch = wt.branch;
      baseSha = wt.baseSha;
      state = "worktree_ready";
    } catch (err) {
      log.warn("attempts", "worktree creation failed; creating metadata-only attempt", {
        sessionId: input.sessionId,
        attemptName: name,
        err: String(err),
      });
      // Fall back: still create the attempt row so the user sees the failure
      // surfaced rather than the request 500-ing.
      worktreePath = worktreePathFor(input.sessionId, name);
      branch = branchNameFor(input.sessionId, name);
    }
  }

  insertStmt.run(
    id,
    input.sessionId,
    name,
    kind,
    state,
    sandbox,
    worktreePath,
    branch,
    baseSha,
    now,
    now,
  );

  log.info("attempts", "created", {
    id,
    sessionId: input.sessionId,
    name,
    kind,
    state,
    hasWorktree: Boolean(baseSha),
  });

  const row = selectByIdStmt.get(id);
  if (!row) throw new Error("inserted attempt not found");
  return rowToAttempt(row);
}

export function getAttempt(id: string): Attempt | null {
  const row = selectByIdStmt.get(id);
  return row ? rowToAttempt(row) : null;
}

export function listAttempts(sessionId: string): Attempt[] {
  return selectBySessionStmt.all(sessionId).map(rowToAttempt);
}

export function setAttemptState(
  id: string,
  state: AttemptState,
): Attempt | null {
  updateStateStmt.run(state, Date.now(), id);
  return getAttempt(id);
}

export function setCandidate(id: string, isCandidate: boolean): Attempt | null {
  const att = getAttempt(id);
  if (!att) return null;
  const now = Date.now();
  if (isCandidate) {
    clearOtherCandidatesStmt.run(now, att.sessionId, id);
  }
  setCandidateStmt.run(isCandidate ? 1 : 0, now, id);
  return getAttempt(id);
}
