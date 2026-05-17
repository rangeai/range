/**
 * Auto-scaffolded `range.yaml` generator.
 *
 * Detects the shape of an attached repo (Playground first, Isaac Lab
 * second, generic Python fallback) and produces a `ScaffoldProposal`
 * with proposed YAML + a short summary. Pure file-inspection — never
 * imports or runs the target repo's Python, so it works against any
 * substrate the user attaches.
 *
 * Hook order: attach-repo handler calls `detectScaffold(repoPath)`. If
 * a non-null proposal comes back AND the repo has no existing
 * `range.yaml`, the proposal is broadcast as a `scaffold_proposed`
 * server message and lives in the conversation as an approval card.
 */

import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ScaffoldProposal,
  ScaffoldSummary,
} from "../shared/protocol.ts";

const RANGE_YAML = "range.yaml";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readFileOr(p: string, fallback = ""): Promise<string> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return fallback;
  }
}

// ─── Playground detector ──────────────────────────────────────────────────

/**
 * Parse the `_envs = { "Name": ..., "Other": ..., }` dict literal from
 * one of Playground's `_src/{locomotion,manipulation,dm_control_suite}/__init__.py`
 * files. We just want the keys — every entry value either calls a class
 * directly or wraps it with `functools.partial`. Regex is sufficient
 * because the dict structure is mechanical and stable in this repo.
 */
function parsePlaygroundEnvKeys(initPyText: string): string[] {
  const m = initPyText.match(/_envs\s*=\s*\{([\s\S]*?)\n\}/);
  if (!m) return [];
  const body = m[1];
  const keys: string[] = [];
  // Match top-level string keys at the start of a (possibly indented)
  // line followed by a colon.
  const keyRe = /^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:/gm;
  let km: RegExpExecArray | null;
  while ((km = keyRe.exec(body)) !== null) keys.push(km[1]);
  return Array.from(new Set(keys));
}

/** Discover reward function methods in an env file. Returns method
 *  names (without the `_reward_` prefix in user-facing display, but
 *  full name on disk). */
function findRewardMethods(text: string): string[] {
  const out: string[] = [];
  const re = /def\s+(_reward_[A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

interface PlaygroundDiscovery {
  envsByCategory: Record<string, string[]>;
  rewardCount: number;
  /** Reward function methods found, keyed by relative file path. */
  rewardsByFile: Map<string, string[]>;
  trainScripts: string[];
}

async function discoverPlayground(
  repoPath: string,
): Promise<PlaygroundDiscovery | null> {
  // Required signature: pyproject.toml must include mujoco-mjx + brax,
  // and `mujoco_playground/_src/{locomotion,manipulation,dm_control_suite}/`
  // must exist.
  const pyproject = await readFileOr(join(repoPath, "pyproject.toml"));
  if (!pyproject) return null;
  const hasMjx = /mujoco-mjx/.test(pyproject);
  const hasBrax = /\bbrax\b/.test(pyproject);
  if (!hasMjx || !hasBrax) return null;

  const srcRoot = join(repoPath, "mujoco_playground", "_src");
  if (!(await isDir(srcRoot))) return null;

  const categories = ["locomotion", "manipulation", "dm_control_suite"];
  const envsByCategory: Record<string, string[]> = {};
  let rewardCount = 0;
  const rewardsByFile = new Map<string, string[]>();

  for (const cat of categories) {
    const catDir = join(srcRoot, cat);
    if (!(await isDir(catDir))) continue;
    const initPy = await readFileOr(join(catDir, "__init__.py"));
    const keys = parsePlaygroundEnvKeys(initPy);
    if (keys.length > 0) envsByCategory[cat] = keys;

    // Walk one level into each robot subdir; tally reward methods in each
    // .py file we find. Keeps inspection cheap.
    const entries = await readdir(catDir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const robotDir = join(catDir, entry.name);
      const files = await readdir(robotDir).catch(() => []);
      for (const f of files) {
        if (!f.endsWith(".py")) continue;
        const fullPath = join(robotDir, f);
        const text = await readFileOr(fullPath);
        const methods = findRewardMethods(text);
        rewardCount += methods.length;
        if (methods.length > 0) {
          const rel = `mujoco_playground/_src/${cat}/${entry.name}/${f}`;
          rewardsByFile.set(rel, methods);
        }
      }
    }
  }

  if (Object.keys(envsByCategory).length === 0) return null;

  const learningDir = join(repoPath, "learning");
  const trainScripts: string[] = [];
  if (await isDir(learningDir)) {
    const files = await readdir(learningDir).catch(() => []);
    for (const f of files) {
      if (f.startsWith("train_") && f.endsWith(".py"))
        trainScripts.push(`learning/${f}`);
    }
  }

  return { envsByCategory, rewardCount, rewardsByFile, trainScripts };
}

/**
 * Pick a small, representative slice of the discovered envs as
 * scenarios. The full env list can be ~40 entries; dropping them all
 * into `range.yaml` would be noise. We want one "happy path" scenario
 * per category, biased toward the most-iterated targets (G1, Go1,
 * Aloha, dm_control's Cartpole).
 */
function pickScenarioSlice(
  envsByCategory: Record<string, string[]>,
): Array<{ name: string; category: string; envName: string }> {
  const wanted = {
    locomotion: [
      "G1JoystickFlatTerrain",
      "Go1JoystickFlatTerrain",
      "BarkourJoystick",
    ],
    manipulation: ["AlohaHandOver", "PandaPickCube", "LeapCubeReorient"],
    dm_control_suite: ["CartpoleBalance", "AcrobotSwingup", "WalkerWalk"],
  };
  const picked: Array<{ name: string; category: string; envName: string }> =
    [];
  for (const [cat, all] of Object.entries(envsByCategory)) {
    const candidates = (wanted as Record<string, string[]>)[cat] ?? [];
    let chose: string | null = null;
    for (const c of candidates) {
      if (all.includes(c)) {
        chose = c;
        break;
      }
    }
    if (!chose && all.length > 0) chose = all[0];
    if (chose) {
      const niceName = chose
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase();
      picked.push({ name: niceName, category: cat, envName: chose });
    }
  }
  return picked;
}

async function buildPlaygroundYaml(
  d: PlaygroundDiscovery,
  repoPath: string,
): Promise<string> {
  const envCount = Object.values(d.envsByCategory).reduce(
    (n, list) => n + list.length,
    0,
  );
  const scenarios = pickScenarioSlice(d.envsByCategory);
  const primaryTrain = d.trainScripts.includes("learning/train_jax_ppo.py")
    ? "learning/train_jax_ppo.py"
    : (d.trainScripts[0] ?? "learning/train_jax_ppo.py");

  // Pick the right Python launcher. Prefer `uv run python` when the
  // repo ships a uv.lock — that gives reproducible env resolution and
  // avoids the "python vs python3" PATH trap on macOS. Fall back to
  // plain `python3` otherwise.
  const hasUvLock = await exists(join(repoPath, "uv.lock"));
  const pyArgs = hasUvLock
    ? '"uv", "run", "python"'
    : '"python3"';
  // jaxlib doesn't ship cp314 wheels yet (as of May 2026). Pin the
  // venv to 3.13 explicitly — Playground's pyproject says >=3.11
  // and jaxlib has wheels up through cp313, so 3.13 is the sweet
  // spot. Subsequent `uv run` invocations pick up the .venv.
  const installNote = hasUvLock
    ? "  install:\n    args: [\"uv\", \"sync\", \"--python\", \"3.13\"]\n    description: Create + sync the venv on Python 3.13 (jaxlib has no cp314 wheels yet)\n"
    : "";

  const lines: string[] = [];
  lines.push("# Auto-generated by Range — edit freely.");
  lines.push("# Detected: MuJoCo Playground");
  lines.push(`# ${envCount} envs across ${Object.keys(d.envsByCategory).length} categories`);
  if (hasUvLock) {
    lines.push("# Found uv.lock — commands use `uv run python` for reproducible env.");
    lines.push("# First time: run `install` to materialize the env.");
  }
  lines.push("version: 1");
  lines.push("");
  lines.push("project:");
  lines.push("  name: mujoco_playground");
  lines.push("  description: MuJoCo Playground — MJX/Brax RL envs");
  lines.push("  stack: mujoco_playground");
  lines.push("  language: python");
  lines.push("");
  lines.push("commands:");
  if (installNote) lines.push(installNote.replace(/\n$/, ""));
  lines.push("  test:");
  lines.push(`    args: [${pyArgs}, "-m", "pytest", "-q", "mujoco_playground"]`);
  lines.push("    description: Run Playground unit tests");
  lines.push("  smoke:");
  lines.push(
    `    args: [${pyArgs}, "${primaryTrain}", "--env_name=CartpoleBalance", "--num_timesteps=100000"]`,
  );
  lines.push("    description: Tiny smoke-eval run (Cartpole, 100k steps)");
  lines.push("");
  lines.push("scenarios:");
  for (const s of scenarios) {
    lines.push(`  - name: ${s.name}`);
    lines.push(`    description: ${s.envName} via ${primaryTrain}`);
    lines.push(
      `    args: [${pyArgs}, "${primaryTrain}", "--env_name=${s.envName}"]`,
    );
    lines.push("    env:");
    lines.push("      RANGE_RUN_DIR: \"${RANGE_RUN_DIR}\"");
  }

  // Reward functions: surface a small representative slice. Emitting
  // every method (~50 across the repo) would bloat the yaml; the user
  // can add more by hand or discover others via `/reward show` later.
  const rewardEntries = pickRewardFunctionSlice(d.rewardsByFile, scenarios);
  if (rewardEntries.length > 0) {
    lines.push("");
    lines.push("reward_functions:");
    for (const r of rewardEntries) {
      lines.push(`  - name: ${r.name}`);
      lines.push(`    file: ${r.file}`);
      lines.push(`    function: ${r.function}`);
    }
  }

  // Checkpoints: Brax PPO writes via orbax-checkpoint under whatever
  // dir the training script chooses. Playground's `learning/` scripts
  // use a --logdir / output flag; we encode a sensible default that
  // also covers the common per-env subdir pattern.
  lines.push("");
  lines.push("checkpoints:");
  lines.push("  - name: brax_ppo");
  lines.push(`    pattern: "logs/**/policy_*"`);
  lines.push(
    "    description: Brax PPO orbax checkpoints (configure --logdir to control output)",
  );

  lines.push("");
  lines.push("verification:");
  lines.push("  gates: []");
  lines.push("");
  return lines.join("\n");
}

/** Pick a slim, scenario-aligned subset of reward methods. For each
 *  scaffold scenario, emit up to 3 reward methods from the env's
 *  primary file. Keeps the yaml readable. */
function pickRewardFunctionSlice(
  rewardsByFile: Map<string, string[]>,
  scenarios: Array<{ name: string; envName: string }>,
): Array<{ name: string; file: string; function: string }> {
  const out: Array<{ name: string; file: string; function: string }> = [];
  for (const s of scenarios) {
    const envLower = s.envName.toLowerCase();
    for (const [file, methods] of rewardsByFile) {
      const m = file.match(/_src\/[^/]+\/([^/]+)\/[^/]+\.py$/);
      if (!m) continue;
      // Family names use underscores (`aloha_hand`); env names don't
      // (`AlohaHandOver`). Strip both to match.
      const family = m[1].toLowerCase().replace(/_/g, "");
      if (!envLower.startsWith(family)) continue;
      for (const fn of methods.slice(0, 3)) {
        const baseName = fn.replace(/^_reward_/, "");
        const niceName = `${s.name}__${baseName}`;
        if (out.some((x) => x.name === niceName)) continue;
        out.push({ name: niceName, file, function: fn });
      }
      break;
    }
  }
  return out;
}

async function detectPlayground(
  repoPath: string,
): Promise<ScaffoldProposal | null> {
  const d = await discoverPlayground(repoPath);
  if (!d) return null;

  const scenarioCount = pickScenarioSlice(d.envsByCategory).length;
  const summary: ScaffoldSummary = {
    commands: 2,
    scenarios: scenarioCount,
    rewardFunctions: d.rewardCount,
    checkpoints: 0,
  };

  const envTotal = Object.values(d.envsByCategory).reduce(
    (n, list) => n + list.length,
    0,
  );
  const notes: string[] = [
    `Found pyproject.toml with \`mujoco-mjx\` + \`brax\` — MuJoCo Playground signature.`,
    `Discovered ${envTotal} envs across ${Object.keys(d.envsByCategory).length} categories (${Object.keys(d.envsByCategory).join(", ")}).`,
    `Picked ${scenarioCount} representative scenarios; remove any you don't want before accepting.`,
    `Detected ${d.rewardCount} reward methods across env files — these become first-class entities in P4.`,
  ];
  if (d.trainScripts.length > 0) {
    notes.push(
      `Training entrypoints: ${d.trainScripts.join(", ")}. Wired the JAX PPO one as the smoke command.`,
    );
  }

  return {
    proposalId: randomUUID(),
    stack: "mujoco_playground",
    stackLabel: "MuJoCo Playground",
    yamlText: await buildPlaygroundYaml(d, repoPath),
    summary,
    notes,
  };
}

// ─── Isaac Lab detector ───────────────────────────────────────────────────

interface IsaacLabTask {
  /** Gym id, e.g. "Isaac-Cartpole-Direct-v0" */
  taskId: string;
  /** "direct" | "manager_based" — surfaces in scenario descriptions */
  category: string;
  /** Robot/family folder name, e.g. "cartpole", "anymal_c" */
  family: string;
}

/**
 * Scan task package init files for `gym.register(id="...", ...)` calls
 * and collect the registered ids. We only care about ids that start
 * with "Isaac-" — matches Isaac Lab's naming convention and filters
 * out any gym registrations from dependencies.
 */
async function collectIsaacLabTasks(
  repoPath: string,
): Promise<IsaacLabTask[]> {
  const tasksRoot = join(
    repoPath,
    "source",
    "isaaclab_tasks",
    "isaaclab_tasks",
  );
  if (!(await isDir(tasksRoot))) return [];

  const tasks: IsaacLabTask[] = [];
  const idRe = /gym\.register\(\s*id\s*=\s*"(Isaac-[^"]+)"/g;

  for (const category of ["direct", "manager_based"]) {
    const catDir = join(tasksRoot, category);
    if (!(await isDir(catDir))) continue;
    // Walk one level: each child is a robot/family dir with an
    // __init__.py + possibly nested task subdirs.
    const families = await readdir(catDir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const fam of families) {
      if (!fam.isDirectory()) continue;
      const famDir = join(catDir, fam.name);
      // Walk recursively for __init__.py — Isaac Lab has multiple
      // nested registration files (e.g., cartpole/cartpole_camera/).
      const initFiles = await findInitPyFiles(famDir);
      for (const initPath of initFiles) {
        const text = await readFileOr(initPath);
        let m: RegExpExecArray | null;
        while ((m = idRe.exec(text)) !== null) {
          tasks.push({ taskId: m[1], category, family: fam.name });
        }
        idRe.lastIndex = 0;
      }
    }
  }
  return tasks;
}

async function findInitPyFiles(
  root: string,
  maxFiles = 50,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 4 || out.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name === "__init__.py") out.push(p);
    }
  }
  await walk(root, 0);
  return out;
}

function pickIsaacScenarios(tasks: IsaacLabTask[]): IsaacLabTask[] {
  // Bias toward the canonical "starter" tasks people actually train.
  const preferred = [
    "Isaac-Cartpole-Direct-v0",
    "Isaac-Velocity-Flat-Anymal-D-v0",
    "Isaac-Lift-Cube-Franka-v0",
    "Isaac-Repose-Cube-Allegro-Direct-v0",
  ];
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const picked: IsaacLabTask[] = [];
  for (const id of preferred) {
    const t = byId.get(id);
    if (t) picked.push(t);
  }
  if (picked.length === 0 && tasks.length > 0) picked.push(tasks[0]);
  return picked;
}

function buildIsaacLabYaml(tasks: IsaacLabTask[]): string {
  const scenarios = pickIsaacScenarios(tasks);
  const trainScript =
    "scripts/reinforcement_learning/sb3/train.py"; // SB3 is the most portable runner

  const lines: string[] = [];
  lines.push("# Auto-generated by Range — edit freely.");
  lines.push("# Detected: Isaac Lab");
  lines.push(`# ${tasks.length} registered tasks (Isaac-*)`);
  lines.push("#");
  lines.push("# Note: Isaac Lab requires NVIDIA RTX GPU + Isaac Sim — these");
  lines.push("# scenarios will not run on macOS. Range still scaffolds them");
  lines.push("# so the same range.yaml works when you push to a Linux box.");
  lines.push("version: 1");
  lines.push("");
  lines.push("project:");
  lines.push("  name: isaac_lab");
  lines.push("  description: Isaac Lab — Isaac Sim-based RL framework");
  lines.push("  stack: isaac_lab");
  lines.push("  language: python");
  lines.push("");
  lines.push("commands:");
  lines.push("  test:");
  lines.push("    args: [\"./isaaclab.sh\", \"-p\", \"-m\", \"pytest\", \"-q\"]");
  lines.push("    description: Run Isaac Lab unit tests");
  lines.push("  smoke:");
  lines.push(
    `    args: [\"./isaaclab.sh\", \"-p\", \"${trainScript}\", \"--task=Isaac-Cartpole-Direct-v0\", \"--num_envs=16\", \"--max_iterations=1\"]`,
  );
  lines.push("    description: Tiny smoke-eval (Cartpole, 1 iter, 16 envs)");
  lines.push("");
  lines.push("scenarios:");
  for (const t of scenarios) {
    const niceName = t.taskId
      .replace(/^Isaac-/, "")
      .replace(/-v\d+$/, "")
      .toLowerCase()
      .replace(/-/g, "_");
    lines.push(`  - name: ${niceName}`);
    lines.push(
      `    description: ${t.taskId} (${t.category} env, family ${t.family})`,
    );
    lines.push(
      `    args: [\"./isaaclab.sh\", \"-p\", \"${trainScript}\", \"--task=${t.taskId}\"]`,
    );
    lines.push("    env:");
    lines.push("      RANGE_RUN_DIR: \"${RANGE_RUN_DIR}\"");
  }
  lines.push("");
  lines.push("verification:");
  lines.push("  gates: []");
  lines.push("");
  return lines.join("\n");
}

async function detectIsaacLab(
  repoPath: string,
): Promise<ScaffoldProposal | null> {
  // Strong shape signal: isaaclab.sh + source/isaaclab_tasks/. We
  // intentionally don't check pyproject.toml — Isaac Lab's is build-
  // tooling-only (ruff config), so it doesn't list runtime deps.
  const hasShim = await exists(join(repoPath, "isaaclab.sh"));
  if (!hasShim) return null;
  const tasks = await collectIsaacLabTasks(repoPath);
  if (tasks.length === 0) return null;

  const scenarios = pickIsaacScenarios(tasks);
  const summary: ScaffoldSummary = {
    commands: 2,
    scenarios: scenarios.length,
    rewardFunctions: 0, // manager-based envs hide rewards; surfaced in P4
    checkpoints: 0,
  };

  const families = new Set(tasks.map((t) => t.family));
  const directCount = tasks.filter((t) => t.category === "direct").length;
  const mbCount = tasks.length - directCount;

  const notes: string[] = [
    `Found \`isaaclab.sh\` + \`source/isaaclab_tasks/\` — Isaac Lab signature.`,
    `Discovered ${tasks.length} registered tasks across ${families.size} families (${directCount} direct, ${mbCount} manager-based).`,
    `Picked ${scenarios.length} representative scenarios biased toward common starter tasks.`,
    `Isaac Sim requires an NVIDIA GPU — these scenarios scaffold correctly but won't launch on macOS. Range targets remote execution (Linux + RTX) in v0.7.`,
  ];

  return {
    proposalId: randomUUID(),
    stack: "isaac_lab",
    stackLabel: "Isaac Lab",
    yamlText: buildIsaacLabYaml(tasks),
    summary,
    notes,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Run all detectors against `repoPath` and return the first match.
 * Returns `null` if no detector recognized the repo, OR if a
 * `range.yaml` already exists (we don't propose over an existing
 * profile).
 */
export async function detectScaffold(
  repoPath: string,
): Promise<ScaffoldProposal | null> {
  if (await exists(join(repoPath, RANGE_YAML))) return null;

  const playground = await detectPlayground(repoPath);
  if (playground) return playground;

  const isaacLab = await detectIsaacLab(repoPath);
  if (isaacLab) return isaacLab;

  // Future: detectGenericPython fallback.
  return null;
}

/**
 * Write the proposed YAML to `<repoPath>/range.yaml`. Refuses if a
 * file already exists at that path — the caller must explicitly
 * delete first (we never overwrite a user's profile).
 */
export async function writeScaffold(
  repoPath: string,
  yamlText: string,
): Promise<{ written: boolean; path: string; error?: string }> {
  const path = join(repoPath, RANGE_YAML);
  if (await exists(path)) {
    return {
      written: false,
      path,
      error: `${basename(path)} already exists — delete it before accepting a new scaffold.`,
    };
  }
  await writeFile(path, yamlText, "utf8");
  return { written: true, path };
}
