/**
 * Demo: import vwxyzjn/cleanrl into Range.
 *
 *   bun run web/tools/demo/cleanrl.ts
 */

import { runDemo } from "./driver.ts";

await runDemo({
  repoPath: "/tmp/range-test-projects/cleanrl",
  videoName: "cleanrl.webm",
});
