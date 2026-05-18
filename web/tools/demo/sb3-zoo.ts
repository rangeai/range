/**
 * Demo: import DLR-RM/rl-baselines3-zoo into Range.
 *
 *   bun run web/tools/demo/sb3-zoo.ts
 */

import { runDemo } from "./driver.ts";

await runDemo({
  repoPath: "/tmp/range-test-projects/rl-baselines3-zoo",
  videoName: "sb3-zoo.webm",
});
