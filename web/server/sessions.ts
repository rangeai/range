/**
 * Sessions are the only top-level work container in the MVP.
 *
 * Each session, if it has a repo_path, owns:
 *   - a git worktree branched from the repo's HEAD
 *   - a Codex thread (codex_thread_id captured when the agent starts)
 *   - a stream of runs (runs.session_id FK)
 *
 * The old per-session "attempts" layer has been collapsed away — there
 * was no parallel-attempts UX yet and the extra entity confused users.
 * If parallel exploration becomes a real need later, we'll introduce
 * a "fork session" feature that creates a peer session branched off
 * this one, instead of nesting attempts inside.
 */

import { db } from "./db.ts";
import { log } from "./log.ts";
import { isGitRepo, createWorktree, removeWorktree } from "./worktree.ts";
import { watchProfile, unwatchProfile } from "./profile_watcher.ts";
import type {
  CreateSessionRequest,
  Sandbox,
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
  worktree_path: string | null;
  branch: string | null;
  base_sha: string | null;
  codex_thread_id: string | null;
  sandbox: string;
  auto_approve: number;
  allowed_commands: string;
  model: string | null;
  reasoning_effort: string | null;
  backend: string;
  model_provider: string | null;
  remote_config: string | null;
  created_at: number;
  updated_at: number;
}

function rowToSession(row: SessionRow): Session {
  let allowed: string[] = [];
  try {
    const parsed = JSON.parse(row.allowed_commands ?? "[]");
    if (Array.isArray(parsed)) {
      allowed = parsed.filter((x) => typeof x === "string");
    }
  } catch {
    allowed = [];
  }
  return {
    id: row.id,
    kind: row.kind as Session["kind"],
    title: row.title,
    prompt: row.prompt,
    repo: row.repo,
    repoPath: row.repo_path,
    taskRef: row.task_ref,
    status: row.status as Session["status"],
    worktreePath: row.worktree_path,
    branch: row.branch,
    baseSha: row.base_sha,
    codexThreadId: row.codex_thread_id,
    sandbox: row.sandbox as Sandbox,
    autoApprove: row.auto_approve === 1,
    allowedCommands: allowed,
    model: row.model,
    reasoningEffort:
      row.reasoning_effort === "low" ||
      row.reasoning_effort === "medium" ||
      row.reasoning_effort === "high"
        ? row.reasoning_effort
        : null,
    backend:
      row.backend === "opencode" ? "opencode" : "codex",
    modelProvider: row.model_provider,
    remoteConfig: parseRemoteConfig(row.remote_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseRemoteConfig(raw: string | null): Session["remoteConfig"] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.provider === "ssh-static" &&
      typeof parsed.host === "string"
    ) {
      return parsed as Session["remoteConfig"];
    }
  } catch {
    // ignore — null is the safe fallback
  }
  return null;
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
    status, sandbox, backend, remote_config, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'workspace-write', ?, ?, ?, ?)
`);

const selectByIdStmt = db.prepare<SessionRow, [string]>(
  "SELECT * FROM sessions WHERE id = ?",
);

const selectListStmt = db.prepare<SessionRow, [number]>(
  "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?",
);

const setWorktreeStmt = db.prepare(`
  UPDATE sessions
  SET worktree_path = ?, branch = ?, base_sha = ?, updated_at = ?
  WHERE id = ?
`);

const setCodexThreadIdStmt = db.prepare(`
  UPDATE sessions SET codex_thread_id = ?, updated_at = ? WHERE id = ?
`);

export async function validateRepoPath(repoPath: string): Promise<void> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error(
      `repoPath "${repoPath}" is not a git repository (or does not exist)`,
    );
  }
}

const updateRepoPathStmt = db.prepare(`
  UPDATE sessions SET repo_path = ?, updated_at = ? WHERE id = ?
`);

/**
 * Attach a repo to an existing session that previously had none. Validates
 * the path, sets repo_path, spawns a worktree, and persists worktree
 * metadata. The caller is responsible for restarting Codex if needed.
 */
export async function attachRepo(
  sessionId: string,
  repoPath: string,
): Promise<Session> {
  const existing = getSession(sessionId);
  if (!existing) throw new Error(`session not found: ${sessionId}`);
  if (existing.worktreePath) {
    throw new Error("session already has a worktree attached");
  }
  await validateRepoPath(repoPath);

  updateRepoPathStmt.run(repoPath, Date.now(), sessionId);

  const wt = await createWorktree({
    repoPath,
    sessionId,
    attemptName: "main",
  });
  setWorktreeStmt.run(wt.path, wt.branch, wt.baseSha, Date.now(), sessionId);

  watchProfile(sessionId, repoPath);

  const fresh = getSession(sessionId);
  if (!fresh) throw new Error("session disappeared after attach");
  return fresh;
}

export async function createSession(
  req: CreateSessionRequest,
): Promise<Session> {
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
    req.backend ?? "codex",
    req.remoteConfig ? JSON.stringify(req.remoteConfig) : null,
    now,
    now,
  );

  // If a repo is attached, spawn the worktree synchronously so the
  // session is immediately useful. Failures are surfaced via the row
  // having a null worktree_path; we don't fail session creation since
  // the user might want to attach a repo later (future feature).
  if (req.repoPath) {
    try {
      const wt = await createWorktree({
        repoPath: req.repoPath,
        sessionId: id,
        attemptName: "main",
      });
      setWorktreeStmt.run(wt.path, wt.branch, wt.baseSha, Date.now(), id);
    } catch (err) {
      log.warn("sessions", "worktree spawn failed, keeping session without one", {
        sessionId: id,
        err: String(err instanceof Error ? err.message : err),
      });
    }
    // Watch range.yaml for changes from any source — scaffold accept,
    // agent apply_patch, or a direct user edit. See profile_watcher.ts.
    watchProfile(id, req.repoPath);
  }

  const row = selectByIdStmt.get(id);
  if (!row) throw new Error("inserted session not found");
  return rowToSession(row);
}

export function getSession(id: string): Session | null {
  const row = selectByIdStmt.get(id);
  return row ? rowToSession(row) : null;
}

export function listSessions(limit = 50): Session[] {
  return selectListStmt.all(limit).map(rowToSession);
}

export function setSessionCodexThreadId(
  id: string,
  threadId: string | null,
): Session | null {
  setCodexThreadIdStmt.run(threadId, Date.now(), id);
  return getSession(id);
}

const setAutoApproveStmt = db.prepare(
  "UPDATE sessions SET auto_approve = ?, updated_at = ? WHERE id = ?",
);
const setAllowedCommandsStmt = db.prepare(
  "UPDATE sessions SET allowed_commands = ?, updated_at = ? WHERE id = ?",
);
const setSandboxStmt = db.prepare(
  "UPDATE sessions SET sandbox = ?, updated_at = ? WHERE id = ?",
);

const VALID_SANDBOXES: ReadonlySet<Sandbox> = new Set<Sandbox>([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

export function setSessionSandbox(
  id: string,
  sandbox: Sandbox,
): Session | null {
  if (!VALID_SANDBOXES.has(sandbox)) {
    throw new Error(`invalid sandbox: ${sandbox}`);
  }
  setSandboxStmt.run(sandbox, Date.now(), id);
  return getSession(id);
}

const setModelStmt = db.prepare(
  "UPDATE sessions SET model = ?, model_provider = ?, updated_at = ? WHERE id = ?",
);
const setReasoningStmt = db.prepare(
  "UPDATE sessions SET reasoning_effort = ?, updated_at = ? WHERE id = ?",
);

export function setSessionModel(
  id: string,
  model: string | null,
  provider?: string | null,
): Session | null {
  const m = model && model.trim().length > 0 ? model.trim() : null;
  const p = provider && provider.trim().length > 0 ? provider.trim() : null;
  setModelStmt.run(m, p, Date.now(), id);
  return getSession(id);
}

export function setSessionReasoningEffort(
  id: string,
  effort: "low" | "medium" | "high" | null,
): Session | null {
  if (effort !== null && !["low", "medium", "high"].includes(effort)) {
    throw new Error(`invalid reasoning effort: ${effort}`);
  }
  setReasoningStmt.run(effort, Date.now(), id);
  return getSession(id);
}

export function setSessionAutoApprove(
  id: string,
  enabled: boolean,
): Session | null {
  setAutoApproveStmt.run(enabled ? 1 : 0, Date.now(), id);
  return getSession(id);
}

export function setSessionAllowedCommands(
  id: string,
  binaries: string[],
): Session | null {
  // Normalize: lowercase, dedupe, drop empties.
  const norm = Array.from(
    new Set(binaries.map((b) => b.trim().toLowerCase()).filter(Boolean)),
  );
  setAllowedCommandsStmt.run(JSON.stringify(norm), Date.now(), id);
  return getSession(id);
}

export function allowCommand(id: string, binary: string): Session | null {
  const s = getSession(id);
  if (!s) return null;
  const next = Array.from(new Set([...s.allowedCommands, binary.toLowerCase()]));
  return setSessionAllowedCommands(id, next);
}

export function disallowCommand(id: string, binary: string): Session | null {
  const s = getSession(id);
  if (!s) return null;
  const lower = binary.toLowerCase();
  return setSessionAllowedCommands(
    id,
    s.allowedCommands.filter((b) => b !== lower),
  );
}

const deleteStmt = db.prepare("DELETE FROM sessions WHERE id = ?");

/**
 * Delete a session. Removes the git worktree (best-effort) and the DB
 * row; runs cascade via FK. The caller is responsible for stopping any
 * live Codex thread before calling this.
 */
export async function deleteSession(id: string): Promise<boolean> {
  const session = getSession(id);
  if (!session) return false;

  if (session.repoPath && session.worktreePath) {
    try {
      await removeWorktree({
        repoPath: session.repoPath,
        worktreePath: session.worktreePath,
      });
    } catch (err) {
      log.warn("sessions", "worktree remove failed", {
        sessionId: id,
        err: String(err instanceof Error ? err.message : err),
      });
    }
  }

  unwatchProfile(id);

  deleteStmt.run(id);
  log.info("sessions", "deleted", { id });
  return true;
}
