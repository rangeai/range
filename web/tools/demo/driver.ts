/**
 * Shared Playwright driver for Range import-demo videos.
 *
 * Each demo script (sb3-zoo.ts, cleanrl.ts, ...) imports `runDemo`
 * with a target repo + a few cosmetic fields, and gets a deterministic
 * .webm recording out the other side.
 *
 * Assumes the Range dev server is already running on :5173.
 */

import { chromium } from "playwright";
import { mkdir, readdir, rename, rm, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

export interface DemoConfig {
  /** Absolute path to a cloned target repo. */
  repoPath: string;
  /** Output filename (relative to output/). */
  videoName: string;
  /** What we type into the prompt box. */
  prompt?: string;
  /** Whether to wipe the target repo's range.yaml first. Default true so
   *  the scaffold detector actually fires on re-runs. */
  resetTargetRepo?: boolean;
}

const RANGE_URL = "http://localhost:5173";
const DEFAULT_PROMPT =
  "Take a look around this repo and propose a Range scaffold — detect " +
  "the stack, surface scenarios if you can find them, and offer a " +
  "range.yaml.";

export async function runDemo(cfg: DemoConfig): Promise<void> {
  if (!existsSync(cfg.repoPath)) {
    throw new Error(`repo not found at ${cfg.repoPath}`);
  }

  const OUT_DIR = resolve(import.meta.dir, "output");

  // Fresh slate for the output dir (per-demo subfolder so demos can be
  // run back-to-back without stomping each other).
  const demoOutDir = join(OUT_DIR, cfg.videoName.replace(/\.webm$/, ""));
  await rm(demoOutDir, { recursive: true, force: true });
  await mkdir(demoOutDir, { recursive: true });

  if (cfg.resetTargetRepo !== false) {
    for (const stale of [
      join(cfg.repoPath, "range.yaml"),
      join(cfg.repoPath, "tools", "range_shim.py"),
    ]) {
      if (existsSync(stale)) {
        try {
          await unlink(stale);
        } catch {
          // ignore
        }
      }
    }
  }

  const browser = await chromium.launch({ headless: false, slowMo: 120 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: demoOutDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  console.log("→ opening Range");
  await page.goto(RANGE_URL);

  const prompt = page.getByPlaceholder(/pull in SIM-1842/i);
  await prompt.waitFor({ state: "visible", timeout: 15_000 });

  const repoInput = page.getByPlaceholder(/repo path/i);
  await repoInput.fill(cfg.repoPath);
  await prompt.fill(cfg.prompt ?? DEFAULT_PROMPT);

  console.log("→ submitting session");
  await prompt.press("Enter");

  console.log("→ waiting for scaffold proposal");
  const acceptButton = page.getByRole("button", { name: /accept · write/i });
  await acceptButton.waitFor({ state: "visible", timeout: 180_000 });
  await page.waitForTimeout(3_000);

  console.log("→ accepting scaffold");
  await acceptButton.click();
  await page
    .getByText("accepted ✓")
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(3_000);

  console.log("→ opening slash picker to show scenarios");
  const composer = page
    .getByPlaceholder(/type a message.*scenarios|scenarios.*commands/i)
    .first();
  try {
    await composer.waitFor({ state: "visible", timeout: 10_000 });
    await composer.click();
    await composer.type("/", { delay: 200 });
    await page.waitForTimeout(3_500);
  } catch {
    // agent still warming — fine
  }
  await page.waitForTimeout(1_000);

  console.log("→ closing browser (this flushes the video)");
  await context.close();
  await browser.close();

  // Rename the auto-named .webm to something predictable. Demo's own
  // subfolder means there should be exactly one .webm here.
  const files = await readdir(demoOutDir);
  const webm = files.find((f) => f.endsWith(".webm"));
  const finalPath = join(OUT_DIR, cfg.videoName);
  if (webm) {
    await rename(join(demoOutDir, webm), finalPath);
    await rm(demoOutDir, { recursive: true, force: true });
    console.log(`✓ video at ${finalPath}`);
  } else {
    console.log("⚠ no .webm produced — check Playwright output");
  }
}
