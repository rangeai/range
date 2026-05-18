/**
 * B1 fixture run — Range side.
 *
 * Drives the canonical "/investigate finds the NaN bug" flow on the
 * cartpole-reward-nan fixture branch of the Playground fork. Records
 * the full session as video + transcript.
 *
 * Pre-reqs (done outside this script):
 *   - The fork at /Users/$USER/personal/mujoco_playground is checked
 *     out on range-fixture-cartpole-reward-nan.
 *   - uv sync --python 3.13 has been run once so /install is fast.
 *
 *   bun run web/tools/demo/b1-fixture-cartpole-range.ts
 */

import { runDemo } from "./driver.ts";

const REPO = "/Users/dhavalp/personal/mujoco_playground";

await runDemo({
  repoPath: REPO,
  videoName: "b1-fixture-cartpole-range.webm",
  prompt: "",
  resetTargetRepo: false,
  actions: [
    // After scaffold accept, Range proposes Playground scenarios.
    // /install is the first thing to run — uv sync, brax/mjx download.
    { kind: "pause", ms: 2_000 },
    { kind: "send", text: "/install" },
    {
      // Look for the install run to finish. "succeeded" appears in the
      // run-state badge once uv sync exits 0.
      kind: "waitForText",
      pattern: /\bsucceeded\b/i,
      timeoutMs: 600_000,
    },
    { kind: "pause", ms: 2_000 },

    // First training run — should hit the planted log(0) → NaN bug
    // during PPO's early exploration when the pole goes near fully down.
    { kind: "send", text: "/cartpole_balance" },
    {
      // Look for either failure (NaN aborts the script) OR the
      // diagnostic output Range's runner emits when reward goes bad.
      kind: "waitForText",
      pattern: /\bfailed\b|nan|inf/i,
      timeoutMs: 600_000,
    },
    { kind: "pause", ms: 3_000 },

    // The headline: /investigate auto-picks the latest failed run and
    // hands Codex a structured trajectory report.
    { kind: "send", text: "/investigate" },
    // Codex takes 30-120s to read the report + propose a fix. We wait
    // for its turn to finish (composer becomes enabled again).
    { kind: "awaitComposerReady", timeoutMs: 300_000 },
    { kind: "pause", ms: 4_000 },

    // Export the conversation as markdown for the blog post.
    { kind: "send", text: "/transcript fixture-01-range.md" },
    { kind: "pause", ms: 3_000 },
  ],
});
