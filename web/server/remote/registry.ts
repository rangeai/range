/**
 * Per-session registry of live RemoteProvider + EnvironmentHandle
 * pairs. Populated by the agent backend when it provisions a remote
 * (currently only codex.ts), read by any other module that wants to
 * run commands on the same remote — typically runner.ts spawning
 * scenarios.
 *
 * One entry per session, lifetime is bounded by the agent backend's
 * teardown.
 */

import type {
  EnvironmentHandle,
  Machine,
  RemoteProvider,
} from "./provider.ts";

export interface SessionRemoteEntry {
  provider: RemoteProvider;
  machine: Machine;
  env: EnvironmentHandle;
}

const entries = new Map<string, SessionRemoteEntry>();

export function setSessionRemote(
  sessionId: string,
  entry: SessionRemoteEntry,
): void {
  entries.set(sessionId, entry);
}

export function getSessionRemote(
  sessionId: string,
): SessionRemoteEntry | null {
  return entries.get(sessionId) ?? null;
}

export function clearSessionRemote(sessionId: string): void {
  entries.delete(sessionId);
}

/**
 * Where a remote scenario writes its per-run artifacts (events.jsonl,
 * metrics.json, trajectory.npz, etc.). Mirrors the convention runner.ts
 * uses when it sets RANGE_RUN_DIR for remote spawns.
 */
export function remoteRunDir(env: EnvironmentHandle, runId: string): string {
  return `${env.remoteRepoPath}/.range-runs/${runId}`;
}

/**
 * Read a per-run artifact as a string. Routes through the remote
 * provider's spawn when the session has a remote attached, falling
 * back to a local read otherwise. Caller passes the *local* fallback
 * path and the *relative* file name under the run dir.
 *
 * Use for small-to-medium text files (events.jsonl, metrics.json).
 * Don't use for trajectory.npz or other binary blobs — that needs
 * fetch()-to-tmp instead.
 */
export async function readRunArtifactText(opts: {
  sessionId: string;
  runId: string;
  /** File name relative to the run dir, e.g. "events.jsonl". */
  filename: string;
  /** Local fallback path used when the session has no remote. */
  localPath: string;
}): Promise<string> {
  const remote = entries.get(opts.sessionId);
  if (!remote) {
    return await Bun.file(opts.localPath).text();
  }
  const remotePath = `${remoteRunDir(remote.env, opts.runId)}/${opts.filename}`;
  const proc = remote.env.spawn(["cat", remotePath]);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `failed to read ${remotePath} on ${remote.machine.id}: ${stderr.trim() || `exit ${exitCode}`}`,
    );
  }
  return stdout;
}
