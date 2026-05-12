/**
 * Git worktree management.
 *
 * For a session with a real repo_path, attempts get an isolated worktree
 * branched off a base ref. Worktrees live at:
 *   ~/.range/worktrees/<session_id>/<attempt_name>
 *
 * The worktree path and branch name are deterministic from the attempt id
 * so we can reconstruct after a crash without writing extra state.
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

export function worktreePathFor(sessionId: string, attemptName: string): string {
  return join(homedir(), ".range", "worktrees", sessionId, attemptName);
}

export function branchNameFor(sessionId: string, attemptName: string): string {
  return `range/${sessionId}/${attemptName}`;
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
  attemptName: string;
  baseBranch?: string;
}): Promise<WorktreeInfo> {
  const { repoPath, sessionId, attemptName } = opts;
  const baseBranch = opts.baseBranch ?? "main";

  if (!(await isGitRepo(repoPath))) {
    throw new Error(`not a git repo: ${repoPath}`);
  }

  const wtPath = worktreePathFor(sessionId, attemptName);
  const branch = branchNameFor(sessionId, attemptName);

  // Resolve baseBranch → SHA (try the requested branch, fall back to HEAD).
  let baseSha: string;
  try {
    baseSha = (await git(repoPath, "rev-parse", baseBranch)).trim();
  } catch {
    baseSha = (await git(repoPath, "rev-parse", "HEAD")).trim();
  }

  // Ensure parent dir exists.
  await mkdir(join(wtPath, ".."), { recursive: true });

  // git worktree add -b <branch> <path> <base_sha>
  await git(repoPath, "worktree", "add", "-b", branch, wtPath, baseSha);

  log.info("worktree", "created", {
    sessionId,
    attemptName,
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
    // Worktree may not exist if it was already cleaned up. Fall back to rmdir.
    log.warn("worktree", "worktree remove failed, falling back to rm", {
      err: String(err),
    });
    await rm(opts.worktreePath, { recursive: true, force: true });
  }
}
