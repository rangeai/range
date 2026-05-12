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
  ProfileCommand,
  ProfileLoadResult,
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

  return { version, project, commands };
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
