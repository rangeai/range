/**
 * SB3 scenario 2: scaffold already accepted, kick off a real CartPole PPO
 * training run and watch the reward stream into Range.
 *
 *   bun run web/tools/demo/sb3-train.ts
 */

import { runDemo } from "./driver.ts";

const REPO = "/tmp/range-test-projects/rl-baselines3-zoo";

const RANGE_YAML = `# Pre-baked for the "first training run" demo.
version: 1

project:
  name: rl_baselines3_zoo
  description: SB3-zoo — CartPole-v1 PPO smoke
  stack: generic_python
  language: python

commands:
  smoke:
    args: ["${REPO}/.venv/bin/python", "train.py", "--algo", "ppo", "--env", "CartPole-v1", "-n", "5000", "--log-folder", "/tmp/range-sb3-logs"]
    description: 5k-step CartPole PPO smoke

scenarios:
  - name: train
    description: PPO + CartPole-v1, 30k steps
    args: ["${REPO}/.venv/bin/python", "train.py", "--algo", "ppo", "--env", "CartPole-v1", "-n", "30000", "--log-folder", "/tmp/range-sb3-logs"]
    env:
      RANGE_RUN_DIR: "\${RANGE_RUN_DIR}"

verification:
  gates: []
`;

await runDemo({
  repoPath: REPO,
  videoName: "sb3-train.webm",
  // No initial agent turn — we want the composer free so we can
  // immediately fire /train.
  prompt: "",
  resetTargetRepo: false,
  seedYaml: RANGE_YAML,
  skipScaffold: true,
  actions: [
    // Give the session a beat to fully load.
    { kind: "pause", ms: 4_000 },
    // Trigger the train scenario via the slash composer.
    { kind: "send", text: "/train" },
    // Wait for SB3's iteration table — that's the unambiguous signal
    // that training is producing output, and the "ep_rew_mean" row is
    // the headline metric the user wants to see climb.
    { kind: "waitForText", pattern: /ep_rew_mean/i, timeoutMs: 120_000 },
    // Linger so the recording captures a few iterations of output.
    { kind: "pause", ms: 8_000 },
  ],
});
