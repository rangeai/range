/**
 * Remote execution provider — the four-step lifecycle every
 * implementation honors:
 *
 *   1. provision    — get the machine (rent / connect / spin up)
 *   2. setup        — install creds, deps, an agent (codex/claude-code)
 *   3. spawn / exec — run commands on the remote, stream stdio back
 *   4. standDown    — tear down (release the box, drop the lease)
 *
 * Range only supports **coordinator mode** — every provider must
 * deliver an agent on the remote during setup(). The "raw SSH +
 * stream stdout" mode is intentionally not part of the contract:
 * artifacts (trajectory.npz, checkpoints, replay videos) routinely
 * run to gigabytes per run, and routing them back to the local
 * laptop is not viable. Coordinator-mode agents read those files in
 * place and stream KB-scale structured responses instead.
 */

import type { Subprocess } from "bun";

// ─── Lifecycle types ──────────────────────────────────────────────────────

/** What the caller wants in terms of remote resources. Provider-
 *  specific — the SSH-static provider ignores most of this; cloud
 *  providers (Lambda Labs, RunPod, vast.ai) consult it for renting. */
export interface ProvisionSpec {
  /** Provider-specific. Examples: "A100", "H100x8", "cpu". */
  gpuType?: string;
  /** Provider-specific region preference. */
  region?: string;
  /** Soft budget hint in USD/hour — provider chooses an instance
   *  type that fits. */
  maxHourlyUsd?: number;
  /** Provider-specific overrides. */
  extra?: Record<string, unknown>;
}

/** A provisioned (or pre-existing) target machine. */
export interface Machine {
  /** Provider-scoped identifier; need not be globally unique. */
  id: string;
  /** Provider name that created this Machine — for routing teardown
   *  calls back to the right implementation. */
  providerName: string;
  /** Provider-specific addressing. For ssh-static, sshAlias is set. */
  addressing: {
    sshAlias?: string;
    ip?: string;
    port?: number;
    [k: string]: unknown;
  };
  /** When the machine was provisioned (ms). */
  provisionedAt: number;
}

/** What the caller wants installed on the machine during setup. */
export interface EnvironmentSpec {
  /** Range session ID — used to namespace the remote workspace. */
  sessionId: string;
  /** Local path of the repo to mirror onto the remote. The provider
   *  rsync's (or otherwise transports) this to remoteRepoPath. */
  repoPath: string;
  /** Which agent to use on the remote. The provider is responsible
   *  for verifying / installing it during setup(). */
  agentKind: "codex" | "claude-code" | "opencode";
  /** Optional env-var bag to inject when commands run. Secrets
   *  (wandb keys, HF tokens) typically live here. */
  remoteEnv?: Record<string, string>;
}

/** What the provider hands back after setup completes — the handle
 *  the rest of Range uses to actually run things on the remote. */
export interface EnvironmentHandle {
  /** ID of the Machine this environment lives on. */
  machineId: string;
  /** Absolute remote path where the repo mirror lives. The agent's
   *  cwd typically defaults to this. */
  remoteRepoPath: string;
  /** Which agent ended up installed/configured. */
  agentKind: "codex" | "claude-code" | "opencode";

  /**
   * Spawn a command on the remote. The returned Subprocess has the
   * same shape as a local Bun.spawn — stdin/stdout/stderr are pipes
   * the caller reads / writes.
   *
   * The local stdio pair represents the *remote* process's stdio. So
   * `proc.stdin.write(...)` sends bytes that arrive on stdin of the
   * remote command; `proc.stdout` yields the remote command's
   * stdout, line for line.
   */
  spawn(
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string> },
  ): Subprocess<"pipe", "pipe", "pipe">;

  /** Pull a single file (or directory) from remote to local. Used
   *  for the rare case Range needs an artifact on the laptop —
   *  most workflows leave the file remote and ask the agent. */
  fetch(remotePath: string, localPath: string): Promise<void>;

  /** Push a single file to the remote. Used to seed config or
   *  incremental edits. Bulk repo sync happens at setup() time. */
  push(localPath: string, remotePath: string): Promise<void>;
}

// ─── Provider interface ───────────────────────────────────────────────────

export interface RemoteProvider {
  /** Stable name — matches what `range.yaml`'s `remote.provider`
   *  field references. */
  readonly name: string;

  /** Free-text description for UI badges / logs. */
  readonly description: string;

  provision(spec: ProvisionSpec): Promise<Machine>;
  setup(machine: Machine, env: EnvironmentSpec): Promise<EnvironmentHandle>;
  standDown(machine: Machine): Promise<void>;
}

// ─── Registry ─────────────────────────────────────────────────────────────

const providers = new Map<string, RemoteProvider>();

export function registerProvider(provider: RemoteProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): RemoteProvider | undefined {
  return providers.get(name);
}

export function listProviders(): RemoteProvider[] {
  return [...providers.values()];
}
