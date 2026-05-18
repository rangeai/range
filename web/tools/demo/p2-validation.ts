/**
 * E2E validation for P2 (/transcript builtin).
 *
 * Opens a real Range session, types /transcript, captures the download
 * triggered by the slash handler, writes it to /tmp, and prints the head.
 *
 *   bun run web/tools/demo/p2-validation.ts <sessionId>
 */

import { chromium } from "playwright";
import { resolve } from "node:path";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: bun run web/tools/demo/p2-validation.ts <sessionId>");
  process.exit(2);
}

const RANGE_URL = "http://localhost:5173";
const OUT = `/tmp/range-transcript-${sessionId}.md`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();

console.log("→ opening Range");
await page.goto(RANGE_URL);

// Navigate via clicking the session in the left nav. Sessions are
// listed by recency; we use a more direct path: drive zustand store via
// `localStorage` or just navigate by URL — Range doesn't use URLs.
// Easiest: wait for the session row to appear in left nav, click it.
await page.waitForSelector(".navbar__brand, button", { timeout: 10_000 }).catch(() => {});

// Range doesn't expose sessions by URL — open the session by clicking
// the matching row in the left nav. Use page.evaluate to call the
// store's openSession directly since it's the simplest reliable handle.
await page.evaluate((sid) => {
  // useAppStore isn't on window, but the store is module-scoped. Fall back
  // to clicking the matching row in the left nav.
  const buttons = Array.from(document.querySelectorAll("button"));
  // Each SessionRow renders the session title; we don't know the title here,
  // but each row's button has a data attr or we can match by aria. Simplest:
  // click the first session row.
  const row = buttons.find(
    (b) =>
      b.querySelector(".uppercase") &&
      b.textContent &&
      b.textContent.toLowerCase().includes("freeform"),
  );
  row?.click();
  return Boolean(row);
}, sessionId);

await page.waitForTimeout(2_000);

// Set up download capture
const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });

// Type /transcript and submit
const composer = page
  .getByPlaceholder(/type a message|scenarios.*commands|Codex is/i)
  .first();
await composer.waitFor({ state: "visible", timeout: 10_000 });
await composer.click();
await composer.fill("/transcript");
await page.waitForTimeout(300);
await composer.press("Enter");

console.log("→ waiting for download");
const download = await downloadPromise;
await download.saveAs(OUT);
console.log(`✓ saved transcript to ${OUT}`);

await browser.close();
console.log(`\n=== first 80 lines of ${OUT} ===`);
const text = await Bun.file(OUT).text();
console.log(text.split("\n").slice(0, 80).join("\n"));
console.log(`\n=== total ${text.length} chars ===`);
