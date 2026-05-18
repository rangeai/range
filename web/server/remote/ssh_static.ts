/**
 * SshStaticProvider — the simplest RemoteProvider. The machine is
 * pre-existing; the user has already configured `~/.ssh/config` with
 * a host alias that points at it. Range just talks to that alias.
 *
 *   range.yaml example:
 *     remote:
 *       provider: ssh-static
 *       host: horde
 *       remoteWorkspaceRoot: ~/range-workspaces    # optional
 *
 * provision()  → noop (machine exists)
 * setup()      → ssh-check + rsync the repo to ~/<workspaceRoot>/<sid>
 * spawn()      → `ssh <host> bash -lc '<env> exec <cmd>'`
 * standDown()  → noop (machine isn't ours to release)
 *
 * Coordinator mode is honored: setup() verifies the agent (codex,
 * claude-code, or opencode) is on the remote PATH and refuses
 * otherwise. We don't auto-install agents — that's the user's
 * responsibility per provider docs.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { log } from "../log.ts";

import type {
  EnvironmentHandle,
  EnvironmentSpec,
  Machine,
  ProvisionSpec,
  RemoteProvider,
} from "./provider.ts";

export interface SshStaticConfig {
  /** SSH host alias resolvable via `~/.ssh/config`. */
  host: string;
  /** Optional explicit identity file. Falls back to ssh defaults. */
  identityFile?: string;
  /** Absolute or `~`-prefixed root where Range materializes session
   *  workspaces. Each session gets its own subdir. Defaults to
   *  `~/range-workspaces`. */
  remoteWorkspaceRoot?: string;
}

export class SshStaticProvider implements RemoteProvider {
  readonly name = "ssh-static";
  readonly description = "SSH to a pre-existing host (no provisioning)";
  private readonly cfg: SshStaticConfig;

  constructor(cfg: SshStaticConfig) {
    this.cfg = cfg;
  }

  // ─── Step 1: provision ─────────────────────────────────────────────

  async provision(_spec: ProvisionSpec): Promise<Machine> {
    // Machine pre-exists — just make a Machine handle out of the
    // configured host alias. Verify the connection works so we fail
    // fast if the user's SSH config is broken.
    await this.runSsh(["echo", "ok"], { timeoutMs: 8_000 }).catch((err) => {
      throw new Error(
        `ssh-static: cannot reach host "${this.cfg.host}" — check ~/.ssh/config: ${err}`,
      );
    });
    return {
      id: this.cfg.host,
      providerName: this.name,
      addressing: { sshAlias: this.cfg.host },
      provisionedAt: Date.now(),
    };
  }

  // ─── Step 2: setup ─────────────────────────────────────────────────

  async setup(machine: Machine, env: EnvironmentSpec): Promise<EnvironmentHandle> {
    const host = machine.addressing.sshAlias;
    if (!host) throw new Error("ssh-static: machine has no sshAlias");

    const workspaceRoot = this.cfg.remoteWorkspaceRoot ?? "~/range-workspaces";
    const remoteRepoPath = `${workspaceRoot}/${env.sessionId}`;

    // Verify the requested agent is on the remote PATH. Coordinator
    // mode is non-optional — fail loudly if the user's box doesn't
    // have one.
    await this.runSsh(["command", "-v", env.agentKind], {
      timeoutMs: 8_000,
    }).catch(() => {
      throw new Error(
        `ssh-static: agent "${env.agentKind}" not found on PATH at ${host}. ` +
        `Install it on the remote first; Range does not auto-install agents.`,
      );
    });

    // Create the workspace dir.
    await this.runSsh(["mkdir", "-p", remoteRepoPath], { timeoutMs: 8_000 });

    // Rsync the repo. Exclude the usual heavy/derived stuff.
    await this.rsyncTo(env.repoPath, host, remoteRepoPath);

    log.info("remote.ssh-static", "setup done", {
      sessionId: env.sessionId,
      host,
      remoteRepoPath,
      agentKind: env.agentKind,
    });

    return {
      machineId: machine.id,
      remoteRepoPath,
      agentKind: env.agentKind,
      spawn: (argv, opts) =>
        this.spawnRemote(host, argv, {
          cwd: opts?.cwd ?? remoteRepoPath,
          env: { ...(env.remoteEnv ?? {}), ...(opts?.env ?? {}) },
        }),
      fetch: (rp, lp) => this.rsyncFrom(host, rp, lp),
      push: (lp, rp) => this.rsyncTo(lp, host, rp),
    };
  }

  // ─── Step 4: stand down ────────────────────────────────────────────

  async standDown(_machine: Machine): Promise<void> {
    // Nothing to release — the machine isn't ours. Future polish:
    // optionally `rm -rf ~/range-workspaces/<sid>` so we don't leave
    // stale workspace dirs around indefinitely. Defer until the
    // need is real.
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private sshArgs(): string[] {
    const args = ["ssh"];
    if (this.cfg.identityFile) args.push("-i", this.cfg.identityFile);
    // Disable host-key prompts so we don't hang on first connect.
    // The user has already vouched for the host via ~/.ssh/config.
    args.push("-o", "BatchMode=yes");
    args.push("-o", "StrictHostKeyChecking=accept-new");
    args.push(this.cfg.host);
    return args;
  }

  /**
   * Wrap a logical (argv, env, cwd) into a single remote shell
   * command. We use bash -lc so the remote loads the user's shell
   * profile (PATH for codex etc.). Then we prepend env-var
   * assignments and cd into the cwd before exec'ing.
   */
  private remoteCommandLine(
    argv: string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): string {
    const envParts = Object.entries(opts.env ?? {}).map(
      ([k, v]) => `${k}=${shellQuote(v)}`,
    );
    const cwdPart = opts.cwd ? `cd ${shellQuote(opts.cwd)} && ` : "";
    const cmdPart = argv.map(shellQuote).join(" ");
    return `${cwdPart}${envParts.length ? envParts.join(" ") + " " : ""}exec ${cmdPart}`;
  }

  private spawnRemote(
    host: string,
    argv: string[],
    opts: { cwd?: string; env?: Record<string, string> },
  ) {
    // ssh joins all post-host argv elements with spaces and forwards
    // them to the remote login shell as one big command-string. So
    // we must build a single string, with all bash/quoting baked in,
    // and pass it as one ssh argument.
    const remoteCmd = `bash -lc ${rawQuote(this.remoteCommandLine(argv, opts))}`;
    const fullArgv = [...this.sshArgs(), remoteCmd];
    log.info("remote.ssh-static", "spawn", {
      host,
      argv: argv.slice(0, 3),
      cwd: opts.cwd,
    });
    return Bun.spawn(fullArgv, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  /**
   * Run a one-shot ssh command and capture output. Used for setup
   * probes — not for long-lived agent processes.
   */
  private async runSsh(
    argv: string[],
    opts: { timeoutMs?: number } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    const remoteCmd = `bash -lc ${rawQuote(argv.map(shellQuote).join(" "))}`;
    const proc = Bun.spawn([...this.sshArgs(), remoteCmd], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, opts.timeoutMs ?? 15_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timeout);
    if (exitCode !== 0) {
      throw new Error(
        `ssh '${remoteCmd}' exited ${exitCode}: ${stderr.trim() || stdout.trim()}`,
      );
    }
    return { stdout, stderr };
  }

  private async rsyncTo(
    localPath: string,
    host: string,
    remotePath: string,
  ): Promise<void> {
    const args = [
      "rsync",
      "-az",
      "--delete",
      "--exclude=.git",
      "--exclude=.venv",
      "--exclude=node_modules",
      "--exclude=__pycache__",
      "--exclude=*.pyc",
      "--exclude=wandb",
      "--exclude=outputs",
      "--exclude=runs",
      // Trailing slash on src → copy contents into the dst dir.
      `${localPath.replace(/\/$/, "")}/`,
      `${host}:${remotePath}`,
    ];
    log.info("remote.ssh-static", "rsync →", {
      localPath,
      host,
      remotePath,
    });
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`rsync to ${host} failed (${exitCode}): ${stderr.trim()}`);
    }
  }

  private async rsyncFrom(
    host: string,
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    await mkdir(dirname(localPath), { recursive: true });
    const args = ["rsync", "-az", `${host}:${remotePath}`, localPath];
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`rsync from ${host} failed (${exitCode}): ${stderr.trim()}`);
    }
  }
}

/**
 * POSIX-safe shell quoting — wraps in single-quotes and escapes any
 * embedded single quotes. Avoids the pitfalls of trying to interpret
 * the user's args.
 *
 * Special case: a leading `~` or `~/` needs to stay unquoted so the
 * remote shell can expand it. We rewrite it to `"$HOME"` (quoted),
 * then quote the rest of the path normally. This keeps remote
 * workspace paths like `~/range-workspaces/<sid>` working without
 * forcing the caller to pre-resolve home.
 */
function shellQuote(s: string): string {
  if (s.length === 0) return "''";
  if (s === "~") return `"$HOME"`;
  if (s.startsWith("~/")) {
    const rest = s.slice(2);
    return `"$HOME"/${rawQuote(rest)}`;
  }
  return rawQuote(s);
}

function rawQuote(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

// Suppress unused-import warning — randomUUID is reserved for a
// future provider that needs locally-generated machine ids.
void randomUUID;
