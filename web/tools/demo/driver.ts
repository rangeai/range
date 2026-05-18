/**
 * Shared Playwright driver for Range import-demo videos.
 *
 * Each demo script (sb3-zoo.ts, cleanrl.ts, ...) imports `runDemo`
 * with a target repo + a few cosmetic fields, and gets a deterministic
 * .webm recording out the other side.
 *
 * Assumes the Range dev server is already running on :5173.
 */

import { chromium, type Page } from "playwright";
import {
  mkdir,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
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
  /** Pre-seed the target repo with a specific range.yaml *before* the
   *  session is created — skips the scaffold proposal step entirely.
   *  Useful for scenarios that focus on running / editing, not onboarding. */
  seedYaml?: string;
  /** Skip waiting for + accepting the scaffold proposal. Pairs with
   *  `seedYaml`. */
  skipScaffold?: boolean;
  /** Post-scaffold actions, executed in order. */
  actions?: DemoAction[];
}

export type DemoAction =
  | { kind: "pause"; ms: number }
  /** Type into the composer and press Enter. */
  | { kind: "send"; text: string; preDelayMs?: number }
  /** Wait for any text matching the regex to appear on the page. */
  | { kind: "waitForText"; pattern: RegExp; timeoutMs?: number }
  /** Wait for an element matching the role+name. */
  | { kind: "waitForButton"; name: RegExp; timeoutMs?: number }
  /** Click an element matching role+name. */
  | { kind: "clickButton"; name: RegExp; timeoutMs?: number }
  /** Force a full page reload. Useful when the client's cached profile
   *  is stale after an agent-driven file edit. */
  | { kind: "reload" }
  /** Block until the composer reaches the "ready / accepting input"
   *  state. Use this to wait for an agent turn to finish before doing
   *  anything else. */
  | { kind: "awaitComposerReady"; timeoutMs?: number };

const RANGE_URL = "http://localhost:5173";
const DEFAULT_PROMPT =
  "Take a look around this repo and propose a Range scaffold — detect " +
  "the stack, surface scenarios if you can find them, and offer a " +
  "range.yaml.";

function composerLocator(page: Page) {
  // Match both the active and the "Codex is …" placeholder variants —
  // we need a reference to the textarea even while it's still disabled.
  return page
    .getByPlaceholder(/type a message|scenarios.*commands|Codex is/i)
    .first();
}

async function waitForComposerReady(page: Page, timeoutMs = 240_000) {
  // The textarea is `disabled` until Codex is fully running. Poll for
  // an enabled state — that's when the user (and our /train action)
  // can actually drive it.
  const composer = composerLocator(page);
  await composer.waitFor({ state: "visible", timeout: timeoutMs });
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const disabled = await composer.evaluate((el) =>
      (el as HTMLTextAreaElement).disabled,
    );
    if (!disabled) return;
    await page.waitForTimeout(500);
  }
  throw new Error("composer never enabled — Codex didn't reach running state");
}

async function runAction(page: Page, action: DemoAction): Promise<void> {
  switch (action.kind) {
    case "pause": {
      await page.waitForTimeout(action.ms);
      return;
    }
    case "send": {
      console.log(`→ send: "${action.text.slice(0, 60)}"`);
      await waitForComposerReady(page);
      const composer = composerLocator(page);
      if (action.preDelayMs) await page.waitForTimeout(action.preDelayMs);
      await composer.click();
      // Fully clear any residual text (e.g., from an earlier flubbed
      // type) so we always start from empty.
      await composer.fill("");
      await composer.type(action.text, { delay: 35 });
      // Sanity check: the textarea actually has our text before Enter.
      const value = await composer.inputValue();
      if (value !== action.text) {
        console.warn(
          `→ composer mismatch: typed="${action.text}" got="${value}"`,
        );
      }
      await page.waitForTimeout(400);
      await composer.press("Enter");
      return;
    }
    case "waitForText": {
      console.log(`→ wait for text: ${action.pattern}`);
      const locator = page.getByText(action.pattern).first();
      try {
        await locator.waitFor({
          state: "attached",
          timeout: action.timeoutMs ?? 60_000,
        });
      } catch (err) {
        // Snapshot the page so we can see what's actually in the DOM
        // before bubbling the timeout up.
        try {
          const screenshotPath = `/tmp/playwright-fail-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.error(`→ screenshot saved to ${screenshotPath}`);
          const counts = await page.evaluate(() => ({
            failed: document.body.innerText.match(/\bfailed\b/g)?.length ?? 0,
            succeeded:
              document.body.innerText.match(/\bsucceeded\b/g)?.length ?? 0,
            ep_rew_mean:
              document.body.innerText.match(/ep_rew_mean/g)?.length ?? 0,
          }));
          console.error("→ body text counts:", JSON.stringify(counts));
        } catch {
          // ignore
        }
        throw err;
      }
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });
      } catch {
        // best effort
      }
      return;
    }
    case "waitForButton": {
      console.log(`→ wait for button: ${action.name}`);
      await page
        .getByRole("button", { name: action.name })
        .first()
        .waitFor({ state: "visible", timeout: action.timeoutMs ?? 60_000 });
      return;
    }
    case "clickButton": {
      console.log(`→ click button: ${action.name}`);
      const btn = page.getByRole("button", { name: action.name }).first();
      await btn.waitFor({ state: "visible", timeout: action.timeoutMs ?? 30_000 });
      await btn.click();
      return;
    }
    case "reload": {
      console.log("→ reload page");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(2_000);
      return;
    }
    case "awaitComposerReady": {
      console.log("→ awaiting composer ready (agent turn finishing)");
      await waitForComposerReady(page, action.timeoutMs);
      return;
    }
  }
}

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

  if (cfg.seedYaml !== undefined) {
    await writeFile(join(cfg.repoPath, "range.yaml"), cfg.seedYaml, "utf8");
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
  // Empty prompt is intentional for scenarios that want to start a
  // session without pinging the agent (so the composer becomes
  // enabled quickly instead of being tied up on a no-op turn).
  const initialPrompt = cfg.prompt ?? DEFAULT_PROMPT;
  if (initialPrompt.length > 0) await prompt.fill(initialPrompt);

  console.log("→ submitting session");
  await prompt.press("Enter");

  if (!cfg.skipScaffold) {
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

    if (!cfg.actions || cfg.actions.length === 0) {
      // Default tail: show the slash picker so the recording proves
      // scenarios are live. Only when no custom actions were given.
      console.log("→ opening slash picker to show scenarios");
      const composer = composerLocator(page);
      try {
        await composer.waitFor({ state: "visible", timeout: 10_000 });
        await composer.click();
        await composer.type("/", { delay: 200 });
        await page.waitForTimeout(3_500);
      } catch {
        // agent still warming — fine
      }
      await page.waitForTimeout(1_000);
    }
  }

  for (const action of cfg.actions ?? []) {
    await runAction(page, action);
  }

  // Final hold so the closing state lingers on the recording.
  await page.waitForTimeout(2_000);

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
