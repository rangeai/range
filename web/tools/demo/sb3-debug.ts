/**
 * SB3 scenario 3: a /train run fails because the YAML points at a bogus
 * gym env. The user @-mentions the agent, which reads the error, patches
 * range.yaml, and re-runs successfully.
 *
 *   bun run web/tools/demo/sb3-debug.ts
 */

import { runDemo } from "./driver.ts";

const REPO = "/tmp/range-test-projects/rl-baselines3-zoo";

// CartPole-v9 doesn't exist — Gymnasium will raise a NamespaceNotFound /
// EnvNotFound error within the first second of training, surfacing in
// Range's run log.
const RANGE_YAML = `# Pre-baked for the "debug a failing run" demo.
# Note the env name below: CartPole-v9 is intentionally invalid.
version: 1

project:
  name: rl_baselines3_zoo
  description: SB3-zoo — intentionally broken scenario for the debug demo
  stack: generic_python
  language: python

commands: {}

scenarios:
  - name: train
    description: PPO + (broken) CartPole-v9
    args: ["${REPO}/.venv/bin/python", "train.py", "--algo", "ppo", "--env", "CartPole-v9", "-n", "30000", "--log-folder", "/tmp/range-sb3-logs"]
    env:
      RANGE_RUN_DIR: "\${RANGE_RUN_DIR}"

verification:
  gates: []
`;

await runDemo({
  repoPath: REPO,
  videoName: "sb3-debug.webm",
  // No initial agent turn — composer should be free to fire /train.
  prompt: "",
  resetTargetRepo: false,
  seedYaml: RANGE_YAML,
  skipScaffold: true,
  actions: [
    { kind: "pause", ms: 3_000 },

    // Auto-approve so the agent can read logs + patch range.yaml
    // without forcing the user to click through each tool call mid-demo.
    { kind: "send", text: "/approvals on" },
    { kind: "pause", ms: 2_000 },

    // Step 1: launch the broken /train. It fails ~immediately with
    // "CartPole-v9 not found in gym registry".
    { kind: "send", text: "/train" },
    {
      kind: "waitForText",
      pattern: /not found in gym registry|CartPole-v9|failed/i,
      timeoutMs: 60_000,
    },
    { kind: "pause", ms: 3_000 },

    // Step 2: ask the agent to look at the failure + apply a fix.
    {
      kind: "send",
      text:
        "the /train run just failed — please read the error, then edit " +
        "range.yaml so the train scenario uses a real gym env (the error " +
        "message even suggests one). apply the fix directly.",
    },

    // Wait for Codex's turn to finish before continuing — the agent
    // read+edit typically takes 60-180 seconds. The profile_changed
    // broadcast (P1 fix) auto-refreshes the slash picker on the
    // client when the YAML hits disk, so no reload needed anymore.
    { kind: "awaitComposerReady", timeoutMs: 300_000 },
    { kind: "pause", ms: 2_000 },

    // Step 3: re-run /train against the fixed yaml.
    { kind: "send", text: "/train" },
    {
      kind: "waitForText",
      pattern: /\bsucceeded\b/i,
      timeoutMs: 90_000,
    },
    { kind: "pause", ms: 5_000 },
  ],
});
