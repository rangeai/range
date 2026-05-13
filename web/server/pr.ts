/**
 * PR drafting and publishing.
 *
 * draft(): compose a title + body from worktree git state + the latest
 * verification results.
 *
 * open(): push the session's branch upstream and run `gh pr create`.
 */

import { log } from "./log.ts";
import { getSession } from "./sessions.ts";
import { getLatestResults } from "./verification.ts";
import type {
  Session,
  VerificationResult,
  VerificationStatus,
} from "../shared/protocol.ts";

export interface PrDraft {
  title: string;
  body: string;
  commitCount: number;
  filesChanged: string[];
  base: string;
}

export interface PrOpenResult {
  url: string;
  branch: string;
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function spawnCmd(
  cwd: string,
  cmd: string[],
  env?: Record<string, string>,
): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...Bun.env, ...env } : undefined,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await spawnCmd(cwd, ["git", ...args]);
  if (r.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${r.exitCode}): ${r.stderr.trim()}`,
    );
  }
  return r.stdout;
}

function statusEmoji(s: VerificationStatus): string {
  switch (s) {
    case "pass":
      return "✓";
    case "warn":
      return "!";
    case "fail":
    case "error":
      return "✗";
  }
}

function composeBody(opts: {
  session: Session;
  commits: string[];
  filesChanged: string[];
  verification: VerificationResult[];
  base: string;
}): string {
  const { session, commits, filesChanged, verification, base } = opts;
  const lines: string[] = [];

  lines.push("## Summary");
  if (session.prompt && session.prompt.trim().length > 0) {
    lines.push(session.prompt.trim());
  } else {
    lines.push(session.title);
  }
  lines.push("");

  lines.push("## Changes");
  lines.push(
    `- ${commits.length} commit${commits.length === 1 ? "" : "s"} ahead of \`${base}\``,
  );
  lines.push(
    `- ${filesChanged.length} file${filesChanged.length === 1 ? "" : "s"} modified`,
  );
  lines.push("");

  if (verification.length > 0) {
    lines.push("## Verification");
    for (const r of verification) {
      lines.push(
        `- ${statusEmoji(r.status)} **${r.gateName}** · ${r.status} · ${r.reason}`,
      );
    }
    lines.push("");
  }

  if (commits.length > 0) {
    lines.push("## Commits");
    for (const c of commits) lines.push(`- ${c}`);
    lines.push("");
  }

  if (filesChanged.length > 0 && filesChanged.length <= 30) {
    lines.push("## Files");
    for (const f of filesChanged) lines.push(`- \`${f}\``);
    lines.push("");
  }

  lines.push("");
  lines.push(`_Drafted by Range · session \`${session.id}\`_`);

  return lines.join("\n");
}

async function resolveBase(worktreePath: string): Promise<string> {
  // Try `origin/main` first, fall back to `main`, then HEAD~ as last resort.
  for (const ref of ["origin/main", "main", "origin/master", "master"]) {
    try {
      await git(worktreePath, ["rev-parse", "--verify", ref]);
      return ref;
    } catch {
      // try next
    }
  }
  throw new Error("could not resolve a base branch (origin/main, main, …)");
}

export async function draftPr(sessionId: string): Promise<PrDraft> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);
  if (!session.worktreePath) {
    throw new Error("session has no worktree");
  }
  const wt = session.worktreePath;

  const base = await resolveBase(wt);

  const logOut = await git(wt, [
    "log",
    `${base}..HEAD`,
    "--pretty=format:%h %s",
  ]);
  const commits = logOut
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const filesOut = await git(wt, ["diff", `${base}...HEAD`, "--name-only"]);
  const filesChanged = filesOut
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const verification = getLatestResults(sessionId);

  const title = session.title.length > 70
    ? session.title.slice(0, 67) + "…"
    : session.title;

  const body = composeBody({
    session,
    commits,
    filesChanged,
    verification,
    base: base.replace(/^origin\//, ""),
  });

  return {
    title,
    body,
    commitCount: commits.length,
    filesChanged,
    base,
  };
}

export interface OpenPrInput {
  title: string;
  body: string;
}

export async function openPr(
  sessionId: string,
  input: OpenPrInput,
): Promise<PrOpenResult> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);
  if (!session.worktreePath || !session.branch) {
    throw new Error("session has no worktree/branch");
  }
  const wt = session.worktreePath;
  const branch = session.branch;

  // Check gh is installed.
  const which = await spawnCmd(wt, ["which", "gh"]);
  if (which.exitCode !== 0) {
    throw new Error(
      "`gh` CLI not found. Install GitHub CLI: https://cli.github.com/",
    );
  }

  // Ensure there is at least one commit ahead.
  const base = await resolveBase(wt);
  const ahead = (
    await git(wt, ["rev-list", "--count", `${base}..HEAD`])
  ).trim();
  if (ahead === "0") {
    throw new Error(`no commits ahead of ${base}`);
  }

  // Push the branch. -u sets upstream on first push.
  const push = await spawnCmd(wt, [
    "git",
    "push",
    "-u",
    "origin",
    `HEAD:${branch}`,
  ]);
  if (push.exitCode !== 0) {
    throw new Error(`git push failed: ${push.stderr.trim()}`);
  }
  log.info("pr", "branch pushed", { sessionId, branch });

  // gh pr create — base branch defaults to the repo's default branch when omitted.
  const create = await spawnCmd(wt, [
    "gh",
    "pr",
    "create",
    "--title",
    input.title,
    "--body",
    input.body,
    "--head",
    branch,
  ]);
  if (create.exitCode !== 0) {
    throw new Error(`gh pr create failed: ${create.stderr.trim()}`);
  }
  const url = create.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!url) throw new Error("gh pr create returned no URL");
  log.info("pr", "created", { sessionId, url });

  return { url, branch };
}
