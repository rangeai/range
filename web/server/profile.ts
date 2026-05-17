/**
 * `range.yaml` profile loader.
 *
 * Lives at <repoPath>/range.yaml. Parses with minimal coercion and
 * supports three shorthand forms for each command:
 *
 *   commands:
 *     test: "pytest tests/"                          # string → split on whitespace
 *     dev:  ["bun", "run", "dev"]                    # array → use directly
 *     ci:                                            # object form
 *       args: ["bun", "run", "typecheck"]
 *       description: "type-check before push"
 *
 * MVP scope. Scenarios, metrics, verification, runners are reserved for
 * Phase 2 — the loader accepts them in the YAML but does nothing with
 * them yet.
 */

import { parse as parseYaml } from "yaml";
import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { log } from "./log.ts";
import type {
  Profile,
  ProfileCheckpoint,
  ProfileCommand,
  ProfileLoadResult,
  ProfileRewardFunction,
  Scenario,
  ScenarioSweep,
  VerificationCriterion,
  VerificationGate,
} from "../shared/protocol.ts";

const FILENAME = "range.yaml";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function splitShellWords(input: string): string[] {
  // Very naive split — matches what the runner does. Users with quoted
  // args should use the array or object form.
  return input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function coerceCommand(name: string, raw: unknown): ProfileCommand | null {
  if (raw == null) return null;

  if (typeof raw === "string") {
    const args = splitShellWords(raw);
    return args.length === 0 ? null : { name, args };
  }

  if (Array.isArray(raw)) {
    const args = raw.map((v) => String(v)).filter((s) => s.length > 0);
    return args.length === 0 ? null : { name, args };
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const argsRaw = obj.args;
    let args: string[] = [];
    if (typeof argsRaw === "string") {
      args = splitShellWords(argsRaw);
    } else if (Array.isArray(argsRaw)) {
      args = argsRaw.map((v) => String(v)).filter((s) => s.length > 0);
    } else {
      return null;
    }
    if (args.length === 0) return null;
    const description =
      typeof obj.description === "string" ? obj.description : undefined;
    return { name, args, description };
  }

  return null;
}

interface RawYaml {
  version?: unknown;
  project?: {
    name?: unknown;
    description?: unknown;
    stack?: unknown;
    language?: unknown;
  };
  commands?: Record<string, unknown>;
  scenarios?: unknown;
  verification?: {
    gates?: unknown;
  };
  reward_functions?: unknown;
  rewardFunctions?: unknown;
  checkpoints?: unknown;
}

function coerceSweep(raw: unknown): ScenarioSweep | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const paramsRaw = r.params;
  if (!paramsRaw || typeof paramsRaw !== "object") return undefined;
  const params: Record<string, (string | number)[]> = {};
  for (const [k, v] of Object.entries(paramsRaw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const vals: (string | number)[] = [];
    for (const item of v) {
      if (typeof item === "number" || typeof item === "string") vals.push(item);
    }
    if (vals.length > 0) params[k] = vals;
  }
  return Object.keys(params).length > 0 ? { params } : undefined;
}

function coerceEnv(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function coerceScenarios(raw: unknown): Scenario[] {
  if (!Array.isArray(raw)) return [];
  const out: Scenario[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    if (!name) continue;
    const command = typeof r.command === "string" ? r.command : undefined;
    const args = Array.isArray(r.args)
      ? r.args.map((v) => String(v)).filter((s) => s.length > 0)
      : undefined;
    if (!command && (!args || args.length === 0)) continue;
    out.push({
      name,
      command,
      args,
      env: coerceEnv(r.env),
      sweep: coerceSweep(r.sweep),
      description:
        typeof r.description === "string" ? r.description : undefined,
    });
  }
  return out;
}

function coerceCriterion(raw: unknown): VerificationCriterion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const c: VerificationCriterion = {};
  if (typeof r.exit_code === "number") c.exitCode = r.exit_code;
  if (typeof r.exitCode === "number") c.exitCode = r.exitCode;
  if (typeof r.stdout_contains === "string")
    c.stdoutContains = r.stdout_contains;
  if (typeof r.stderr_contains === "string")
    c.stderrContains = r.stderr_contains;
  if (typeof r.stdout_missing === "string")
    c.stdoutMissing = r.stdout_missing;
  return Object.keys(c).length === 0 ? undefined : c;
}

function coerceGates(raw: unknown): VerificationGate[] {
  if (!Array.isArray(raw)) return [];
  const out: VerificationGate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const command = typeof r.command === "string" ? r.command : null;
    if (!name || !command) continue;
    const gate: VerificationGate = {
      name,
      command,
      pass: coerceCriterion(r.pass),
      warn: coerceCriterion(r.warn),
      description:
        typeof r.description === "string" ? r.description : undefined,
    };
    out.push(gate);
  }
  return out;
}

function coerceProfile(raw: unknown): Profile {
  const r = (raw ?? {}) as RawYaml;

  const version =
    typeof r.version === "number" && r.version > 0 ? r.version : 1;

  const project = {
    name:
      typeof r.project?.name === "string" && r.project.name.length > 0
        ? r.project.name
        : "unnamed",
    description:
      typeof r.project?.description === "string"
        ? r.project.description
        : undefined,
    stack:
      typeof r.project?.stack === "string" ? r.project.stack : undefined,
    language:
      typeof r.project?.language === "string"
        ? r.project.language
        : undefined,
  };

  const commands: ProfileCommand[] = [];
  if (r.commands && typeof r.commands === "object") {
    for (const [name, raw] of Object.entries(r.commands)) {
      const c = coerceCommand(name, raw);
      if (c) commands.push(c);
    }
  }

  const scenarios = coerceScenarios(r.scenarios);
  const gates = coerceGates(r.verification?.gates);
  const rewardFunctions = coerceRewardFunctions(
    r.reward_functions ?? r.rewardFunctions,
  );
  const checkpoints = coerceCheckpoints(r.checkpoints);

  return {
    version,
    project,
    commands,
    scenarios,
    gates,
    rewardFunctions,
    checkpoints,
  };
}

function coerceRewardFunctions(raw: unknown): ProfileRewardFunction[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileRewardFunction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const file = typeof r.file === "string" ? r.file : null;
    const fn = typeof r.function === "string" ? r.function : null;
    if (!name || !file || !fn) continue;
    out.push({
      name,
      file,
      function: fn,
      description:
        typeof r.description === "string" ? r.description : undefined,
    });
  }
  return out;
}

function coerceCheckpoints(raw: unknown): ProfileCheckpoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileCheckpoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const pattern = typeof r.pattern === "string" ? r.pattern : null;
    if (!name || !pattern) continue;
    out.push({
      name,
      pattern,
      description:
        typeof r.description === "string" ? r.description : undefined,
    });
  }
  return out;
}

export async function loadProfile(
  repoPath: string,
): Promise<ProfileLoadResult> {
  const path = join(repoPath, FILENAME);
  if (!(await exists(path))) {
    return { profile: null, path, found: false, error: null };
  }
  try {
    const text = await readFile(path, "utf8");
    const raw = parseYaml(text);
    const profile = coerceProfile(raw);
    return { profile, path, found: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("profile", "load failed", { path, err: msg });
    return { profile: null, path, found: true, error: msg };
  }
}
