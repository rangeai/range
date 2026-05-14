/**
 * Scenario resolution + sweep fan-out.
 *
 * A scenario in `range.yaml` is a named, parameterized launch. When the
 * user clicks "run" on a scenario, we:
 *   1. Resolve its base command (either an inline `args` array or a
 *      reference to a `commands` entry by name).
 *   2. Compute the sweep grid: the cartesian product of every
 *      `sweep.params` array. No sweep → one variant with no params.
 *   3. Launch one run per variant, sequentially, each tagged with the
 *      same `sweep_id` and a `sweep_variant` JSON. Per-variant params
 *      are exposed as env vars (RANGE_<KEY>=<value>) plus the full
 *      variant as RANGE_SWEEP_VARIANT.
 */

import { log } from "./log.ts";
import { loadProfile } from "./profile.ts";
import { startRun } from "./runner.ts";
import { getSession } from "./sessions.ts";
import type { Run, Scenario } from "../shared/protocol.ts";

function newSweepId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `swp_${t}${r}`;
}

function resolveArgs(
  scenario: Scenario,
  commandsByName: Map<string, string[]>,
): string[] {
  if (scenario.args && scenario.args.length > 0) return scenario.args;
  if (scenario.command) {
    const args = commandsByName.get(scenario.command);
    if (!args) {
      throw new Error(
        `scenario "${scenario.name}" references unknown command "${scenario.command}"`,
      );
    }
    return args;
  }
  throw new Error(
    `scenario "${scenario.name}" has neither args nor command`,
  );
}

function expandSweep(
  scenario: Scenario,
): Array<Record<string, string | number>> {
  const sweep = scenario.sweep;
  if (!sweep || Object.keys(sweep.params).length === 0) return [{}];
  const keys = Object.keys(sweep.params);
  const variants: Array<Record<string, string | number>> = [{}];
  for (const key of keys) {
    const values = sweep.params[key]!;
    const next: Array<Record<string, string | number>> = [];
    for (const v of variants) {
      for (const value of values) {
        next.push({ ...v, [key]: value });
      }
    }
    variants.splice(0, variants.length, ...next);
  }
  return variants;
}

function variantEnv(
  variant: Record<string, string | number>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(variant)) {
    env[`RANGE_${k.toUpperCase()}`] = String(v);
  }
  return env;
}

export interface RunScenarioInput {
  sessionId: string;
  scenarioName: string;
}

export interface RunScenarioOutcome {
  runs: Run[];
  sweepId: string | null;
}

export async function runScenario(
  input: RunScenarioInput,
): Promise<RunScenarioOutcome> {
  const session = getSession(input.sessionId);
  if (!session) throw new Error(`session not found: ${input.sessionId}`);
  if (!session.repoPath || !session.worktreePath) {
    throw new Error("session has no worktree — attach a repo first");
  }

  const profileResult = await loadProfile(session.repoPath);
  const profile = profileResult.profile;
  if (!profile) {
    throw new Error("no range.yaml profile loaded for this session");
  }

  const scenario = profile.scenarios.find((s) => s.name === input.scenarioName);
  if (!scenario) {
    throw new Error(`scenario "${input.scenarioName}" not found`);
  }

  const commandsByName = new Map<string, string[]>(
    profile.commands.map((c) => [c.name, c.args]),
  );

  const args = resolveArgs(scenario, commandsByName);
  const variants = expandSweep(scenario);
  const sweepId = variants.length > 1 ? newSweepId() : null;

  const runs: Run[] = [];
  for (const variant of variants) {
    const env: Record<string, string> = {
      ...(scenario.env ?? {}),
      ...variantEnv(variant),
    };
    const run = await startRun({
      sessionId: input.sessionId,
      command: args,
      kind: "evaluate",
      env,
      scenarioName: scenario.name,
      sweepId: sweepId ?? undefined,
      sweepVariant: Object.keys(variant).length > 0 ? variant : undefined,
    });
    runs.push(run);
    if (sweepId) {
      // Pace the fan-out so we don't slam the laptop. A real implementation
      // would queue and wait for each to finish before kicking the next; for
      // now, leave them in flight — the runner already serializes IO.
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  log.info("scenarios", "launched", {
    sessionId: input.sessionId,
    scenario: scenario.name,
    runs: runs.length,
    sweepId,
  });
  return { runs, sweepId };
}
