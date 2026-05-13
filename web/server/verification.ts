/**
 * Verification engine.
 *
 * Reads `verification.gates` from a session's `range.yaml`, matches each
 * gate to the profile command it names, and evaluates pass/warn criteria
 * against a completed run's exit code + captured output.
 *
 * Triggered by the runner after a run finishes; broadcasts a
 * `verification_result` over WS and caches the latest result per
 * (sessionId, gateName) in memory for the session view to fetch.
 */

import { log } from "./log.ts";
import { broadcast } from "./hub.ts";
import { loadProfile } from "./profile.ts";
import { readRunEvents } from "./runner.ts";
import { getSession } from "./sessions.ts";
import type {
  ProfileCommand,
  Run,
  VerificationCriterion,
  VerificationGate,
  VerificationResult,
  VerificationStatus,
} from "../shared/protocol.ts";

// sessionId -> gateName -> latest result
const cache = new Map<string, Map<string, VerificationResult>>();

function commandMatches(
  runCommand: string[],
  profileCommand: ProfileCommand,
): boolean {
  if (runCommand.length !== profileCommand.args.length) return false;
  return runCommand.every((a, i) => a === profileCommand.args[i]);
}

interface Evaluation {
  status: VerificationStatus;
  reason: string;
}

function evaluateCriterion(
  c: VerificationCriterion,
  run: Run,
  stdout: string,
  stderr: string,
): { ok: boolean; reason: string } {
  if (c.exitCode != null && run.exitCode !== c.exitCode) {
    return {
      ok: false,
      reason: `expected exit ${c.exitCode}, got ${run.exitCode}`,
    };
  }
  if (c.stdoutContains && !stdout.includes(c.stdoutContains)) {
    return {
      ok: false,
      reason: `stdout missing "${c.stdoutContains}"`,
    };
  }
  if (c.stderrContains && !stderr.includes(c.stderrContains)) {
    return {
      ok: false,
      reason: `stderr missing "${c.stderrContains}"`,
    };
  }
  if (c.stdoutMissing && stdout.includes(c.stdoutMissing)) {
    return {
      ok: false,
      reason: `stdout contains "${c.stdoutMissing}"`,
    };
  }
  return { ok: true, reason: "ok" };
}

function evaluate(
  gate: VerificationGate,
  run: Run,
  stdout: string,
  stderr: string,
): Evaluation {
  // Default pass when not specified: exit_code == 0
  const pass: VerificationCriterion = gate.pass ?? { exitCode: 0 };
  const passResult = evaluateCriterion(pass, run, stdout, stderr);
  if (passResult.ok) {
    return { status: "pass", reason: "pass criteria met" };
  }
  if (gate.warn) {
    const warnResult = evaluateCriterion(gate.warn, run, stdout, stderr);
    if (warnResult.ok) {
      return { status: "warn", reason: passResult.reason };
    }
  }
  return { status: "fail", reason: passResult.reason };
}

export async function evaluateGatesForRun(run: Run): Promise<void> {
  const session = getSession(run.sessionId);
  if (!session?.repoPath) return;

  const profile = await loadProfile(session.repoPath);
  if (!profile.profile || profile.profile.gates.length === 0) return;
  const gates = profile.profile.gates;
  const commands = profile.profile.commands;

  // Find profile-command names whose args match this run
  const matchingNames = new Set<string>();
  for (const c of commands) {
    if (commandMatches(run.command, c)) matchingNames.add(c.name);
  }
  const matchedGates = gates.filter((g) => matchingNames.has(g.command));
  if (matchedGates.length === 0) return;

  // Pull captured output for stdout/stderr predicates (skip read if no
  // gate needs it).
  const needsOutput = matchedGates.some(
    (g) =>
      g.pass?.stdoutContains != null ||
      g.pass?.stderrContains != null ||
      g.pass?.stdoutMissing != null ||
      g.warn?.stdoutContains != null ||
      g.warn?.stderrContains != null ||
      g.warn?.stdoutMissing != null,
  );

  let stdout = "";
  let stderr = "";
  if (needsOutput) {
    try {
      const events = await readRunEvents(run.id);
      for (const ev of events) {
        if (ev.stream === "stdout") stdout += ev.message + "\n";
        else if (ev.stream === "stderr") stderr += ev.message + "\n";
      }
    } catch (err) {
      log.warn("verify", "readRunEvents failed", {
        runId: run.id,
        err: String(err instanceof Error ? err.message : err),
      });
    }
  }

  for (const gate of matchedGates) {
    let result: VerificationResult;
    try {
      const evalResult = evaluate(gate, run, stdout, stderr);
      result = {
        sessionId: run.sessionId,
        runId: run.id,
        gateName: gate.name,
        status: evalResult.status,
        reason: evalResult.reason,
        evaluatedAt: Date.now(),
      };
    } catch (err) {
      result = {
        sessionId: run.sessionId,
        runId: run.id,
        gateName: gate.name,
        status: "error",
        reason: String(err instanceof Error ? err.message : err),
        evaluatedAt: Date.now(),
      };
    }

    let perSession = cache.get(run.sessionId);
    if (!perSession) {
      perSession = new Map();
      cache.set(run.sessionId, perSession);
    }
    perSession.set(gate.name, result);

    broadcast({ type: "verification_result", result });
    log.info("verify", "gate evaluated", {
      sessionId: run.sessionId,
      gate: gate.name,
      status: result.status,
    });
  }
}

export function getLatestResults(sessionId: string): VerificationResult[] {
  const perSession = cache.get(sessionId);
  if (!perSession) return [];
  return [...perSession.values()].sort(
    (a, b) => b.evaluatedAt - a.evaluatedAt,
  );
}
