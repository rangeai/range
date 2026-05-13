/**
 * Git worktree management.
 *
 * Each session with a repo_path owns one worktree at:
 *   ~/.range/worktrees/<session_id>/<name>
 *
 * For MVP, `name` is always "main" — there's one worktree per session.
 * The path is deterministic from the session id so we can reconstruct
 * after a crash without writing extra state.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, access } from "node:fs/promises";
import { log } from "./log.ts";

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseSha: string;
}

export function worktreePathFor(sessionId: string, name = "main"): string {
  return join(homedir(), ".range", "worktrees", sessionId, name);
}

export function branchNameFor(sessionId: string, name = "main"): string {
  return `range/${sessionId}/${name}`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderrText.trim()}`,
    );
  }
  return stdoutText;
}

export async function isGitRepo(path: string): Promise<boolean> {
  if (!(await fileExists(path))) return false;
  try {
    const out = await git(path, "rev-parse", "--is-inside-work-tree");
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export async function createWorktree(opts: {
  repoPath: string;
  sessionId: string;
  /** Subdirectory + branch suffix. Defaults to "main". */
  attemptName?: string;
  baseBranch?: string;
}): Promise<WorktreeInfo> {
  const { repoPath, sessionId } = opts;
  const name = opts.attemptName ?? "main";
  const baseBranch = opts.baseBranch ?? "main";

  if (!(await isGitRepo(repoPath))) {
    throw new Error(`not a git repo: ${repoPath}`);
  }

  const wtPath = worktreePathFor(sessionId, name);
  const branch = branchNameFor(sessionId, name);

  let baseSha: string;
  try {
    baseSha = (await git(repoPath, "rev-parse", baseBranch)).trim();
  } catch {
    baseSha = (await git(repoPath, "rev-parse", "HEAD")).trim();
  }

  await mkdir(join(wtPath, ".."), { recursive: true });
  await git(repoPath, "worktree", "add", "-b", branch, wtPath, baseSha);

  log.info("worktree", "created", {
    sessionId,
    name,
    path: wtPath,
    branch,
    baseSha,
  });

  return { path: wtPath, branch, baseSha };
}

export async function removeWorktree(opts: {
  repoPath: string;
  worktreePath: string;
}): Promise<void> {
  try {
    await git(opts.repoPath, "worktree", "remove", "--force", opts.worktreePath);
  } catch (err) {
    log.warn("worktree", "worktree remove failed, falling back to rm", {
      err: String(err),
    });
    await rm(opts.worktreePath, { recursive: true, force: true });
  }
}
