/**
 * `/wire` — integration helpers for known-fragile patterns.
 *
 * v0.5 P3 covers Hydra + W&B integration: the standard config-tracking
 * combo most RL teams use, with three well-documented foot-guns:
 *
 *   1. `wandb.init()` hangs when run inside a Hydra-launched process
 *      unless `settings=wandb.Settings(start_method="thread")` is set.
 *   2. Passing an `OmegaConf` DictConfig directly to `wandb.config` or
 *      as the `config=` argument silently breaks W&B's serialization;
 *      it has to be unwrapped with `OmegaConf.to_container(..., resolve=True)`.
 *   3. Same for `wandb.config.update(cfg)`.
 *
 * Detection is pure file inspection. Patches are regex-driven and
 * preview-only — nothing lands on disk until the user accepts.
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";

const PY_EXTENSIONS = new Set([".py"]);
const SKIP_DIRS = new Set([
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "logs",
  ".pytest_cache",
  ".mypy_cache",
]);

async function isDir(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** Walk the repo collecting .py files. Skips obvious noise dirs and
 *  bails after 500 files so a stray monorepo doesn't hang the
 *  scanner. */
async function walkPyFiles(
  repoPath: string,
  maxFiles = 500,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= maxFiles || depth > 6) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".") && e.name !== ".") {
        // Allow ".env" etc., reject ".git"
        if (SKIP_DIRS.has(e.name)) continue;
      }
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(p, depth + 1);
      } else if (PY_EXTENSIONS.has(extOf(e.name))) {
        out.push(p);
      }
    }
  }
  await walk(repoPath, 0);
  return out;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

// ─── Detection ────────────────────────────────────────────────────────────

interface FileSignals {
  hasHydraMain: boolean;
  hasOmegaConf: boolean;
  hasWandbInit: boolean;
  hasWandbConfigUpdate: boolean;
  hasWandbConfigAssign: boolean;
  importsWandb: boolean;
}

function scanFileSignals(text: string): FileSignals {
  return {
    hasHydraMain: /@hydra\.main\b/.test(text),
    hasOmegaConf: /\bOmegaConf\b/.test(text) || /\bDictConfig\b/.test(text),
    hasWandbInit: /\bwandb\.init\s*\(/.test(text),
    hasWandbConfigUpdate: /\bwandb\.config\.update\s*\(/.test(text),
    hasWandbConfigAssign: /\bwandb\.config\s*=/.test(text),
    importsWandb: /^\s*import\s+wandb\b/m.test(text),
  };
}

// ─── Patching ─────────────────────────────────────────────────────────────

export interface WirePatch {
  /** Path relative to the repo root, for display + apply. */
  path: string;
  oldText: string;
  newText: string;
  /** Human-readable bullets describing each transform applied. */
  changes: string[];
}

/**
 * Apply the canonical fixes to a single .py file's text. Returns the
 * patched text and the list of human-readable changes, or null if
 * nothing changed.
 */
function patchWandbHydraFile(
  text: string,
): { newText: string; changes: string[] } | null {
  let out = text;
  const changes: string[] = [];

  // ── Fix #1: wandb.init(...) without settings=
  //
  // Match `wandb.init(<args>)`. If `settings=` doesn't appear inside,
  // inject `settings=wandb.Settings(start_method="thread")`. We scan
  // for `wandb.init(` and find the matching `)` with a simple paren
  // counter so we handle multi-line calls.
  out = injectWandbInitSettings(out, changes);

  // ── Fix #2: wandb.init(..., config=cfg)
  //
  // Wrap `config=<expr>` with `OmegaConf.to_container(<expr>, resolve=True)`
  // when (a) the file imports/uses OmegaConf or @hydra.main and (b) the
  // expression isn't already wrapped.
  const sig = scanFileSignals(text);
  const isHydraStyle = sig.hasHydraMain || sig.hasOmegaConf;
  if (isHydraStyle) {
    out = wrapWandbInitConfig(out, changes);
    // ── Fix #3: wandb.config.update(<expr>) — same wrap.
    out = wrapWandbConfigUpdate(out, changes);
  }

  // ── Fix #4: ensure `from omegaconf import OmegaConf` exists IF we
  // inserted OmegaConf.to_container calls.
  if (changes.some((c) => c.includes("OmegaConf.to_container"))) {
    out = ensureOmegaConfImport(out, changes);
  }

  if (out === text) return null;
  return { newText: out, changes };
}

/**
 * Replace every string-literal and comment region with same-length
 * runs of spaces. The result is byte-for-byte equivalent in length
 * to the original (so indices stay valid), but regex searches against
 * it won't match the inside of a docstring or a trailing `# comment`.
 */
function maskStringsAndComments(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    // Triple-quoted strings.
    if (text.slice(i, i + 3) === '"""' || text.slice(i, i + 3) === "'''") {
      const q = text.slice(i, i + 3);
      out.push("   ");
      i += 3;
      while (i < n) {
        if (text.slice(i, i + 3) === q) {
          out.push("   ");
          i += 3;
          break;
        }
        out.push(text[i] === "\n" ? "\n" : " ");
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out.push(" ");
      i++;
      while (i < n) {
        const cc = text[i]!;
        if (cc === "\\") {
          out.push("  ");
          i += 2;
          continue;
        }
        if (cc === quote) {
          out.push(" ");
          i++;
          break;
        }
        if (cc === "\n") {
          // unterminated — emit newline and bail
          out.push("\n");
          i++;
          break;
        }
        out.push(" ");
        i++;
      }
      continue;
    }
    if (c === "#") {
      // line comment to end of line
      while (i < n && text[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/**
 * Build a clean replacement for the inside of a `(...)` call when
 * appending one new kwarg. Handles single-line and multi-line styles:
 * single-line gets `<inner>, kwarg`; multi-line preserves trailing
 * newline + close-paren indent and adds `kwarg,` on its own line.
 */
function appendKwarg(
  inner: string,
  kwarg: string,
): string {
  if (!inner.includes("\n")) {
    // Single-line. Strip any trailing comma + spaces, then append.
    let trimmedEnd = inner.replace(/\s*,?\s*$/, "");
    const sep = trimmedEnd.length > 0 ? ", " : "";
    return `${trimmedEnd}${sep}${kwarg}`;
  }
  // Multi-line. Find the indent of the first kwarg line.
  const indentMatch = inner.match(/\n([ \t]+)\S/);
  const indent = indentMatch ? indentMatch[1] : "    ";
  // Strip trailing whitespace + newlines + comma at the very end of inner.
  const trimmed = inner.replace(/\s*,?\s*$/, "");
  // We want: `<trimmed>,\n<indent>kwarg,\n<outerIndent>`
  // outerIndent = indent of the close paren line ≈ first non-ws before close.
  // Use one fewer-level than the inner indent if possible; default to "".
  const outerIndentMatch = inner.match(/\n([ \t]*)$/);
  const outerIndent = outerIndentMatch ? outerIndentMatch[1] : "";
  return `${trimmed},\n${indent}${kwarg},\n${outerIndent}`;
}

function injectWandbInitSettings(text: string, changes: string[]): string {
  const masked = maskStringsAndComments(text);
  const re = /\bwandb\.init\s*\(/g;
  let m: RegExpExecArray | null;
  const replacements: { start: number; end: number; replacement: string }[] =
    [];
  while ((m = re.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const close = findMatchingParen(text, openIdx);
    if (close < 0) continue;
    const inner = text.slice(openIdx + 1, close);
    if (/\bsettings\s*=/.test(maskStringsAndComments(inner))) continue;
    const injection = appendKwarg(
      inner,
      'settings=wandb.Settings(start_method="thread")',
    );
    replacements.push({
      start: openIdx + 1,
      end: close,
      replacement: injection,
    });
  }
  if (replacements.length === 0) return text;
  let out = text;
  replacements.reverse();
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  changes.push(
    `Inject \`settings=wandb.Settings(start_method="thread")\` into ${replacements.length} \`wandb.init(...)\` call(s) — fixes the Hydra-launched-W&B hang.`,
  );
  return out;
}

function wrapWandbInitConfig(text: string, changes: string[]): string {
  const masked = maskStringsAndComments(text);
  const re = /\bwandb\.init\s*\(/g;
  let m: RegExpExecArray | null;
  let out = text;
  let totalWraps = 0;
  const adjustments: { start: number; end: number; replacement: string }[] =
    [];
  while ((m = re.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const close = findMatchingParen(text, openIdx);
    if (close < 0) continue;
    const inner = text.slice(openIdx + 1, close);
    const cfg = extractKwargExpr(inner, "config");
    if (!cfg) continue;
    if (/OmegaConf\.to_container/.test(cfg.expr)) continue;
    if (cfg.expr.trim().startsWith("{")) continue;
    const wrapped = `OmegaConf.to_container(${cfg.expr.trim()}, resolve=True)`;
    adjustments.push({
      start: openIdx + 1 + cfg.exprStart,
      end: openIdx + 1 + cfg.exprEnd,
      replacement: wrapped,
    });
    totalWraps++;
  }
  if (adjustments.length === 0) return text;
  adjustments.reverse();
  for (const a of adjustments) {
    out = out.slice(0, a.start) + a.replacement + out.slice(a.end);
  }
  changes.push(
    `Wrap the \`config=...\` argument with \`OmegaConf.to_container(..., resolve=True)\` in ${totalWraps} \`wandb.init(...)\` call(s) — W&B can't serialize a DictConfig directly.`,
  );
  return out;
}

function wrapWandbConfigUpdate(text: string, changes: string[]): string {
  const masked = maskStringsAndComments(text);
  const re = /\bwandb\.config\.update\s*\(/g;
  let m: RegExpExecArray | null;
  const replacements: { start: number; end: number; replacement: string }[] =
    [];
  while ((m = re.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const close = findMatchingParen(text, openIdx);
    if (close < 0) continue;
    const inner = text.slice(openIdx + 1, close).trim();
    if (inner.length === 0) continue;
    if (/OmegaConf\.to_container/.test(inner)) continue;
    if (inner.startsWith("{")) continue;
    const wrapped = `OmegaConf.to_container(${inner}, resolve=True)`;
    replacements.push({
      start: openIdx + 1,
      end: close,
      replacement: wrapped,
    });
  }
  if (replacements.length === 0) return text;
  let out = text;
  replacements.reverse();
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  changes.push(
    `Wrap \`wandb.config.update(...)\` argument with \`OmegaConf.to_container(..., resolve=True)\` (${replacements.length} call(s)).`,
  );
  return out;
}

function ensureOmegaConfImport(text: string, changes: string[]): string {
  if (/\bfrom\s+omegaconf\s+import\s+[^\n]*OmegaConf\b/.test(text)) return text;
  // Add an import line right after the last existing top-level import.
  const importRe = /^(?:from\s+\S+\s+import\s+[^\n]+|import\s+[^\n]+)$/gm;
  let lastEnd = -1;
  let mm: RegExpExecArray | null;
  while ((mm = importRe.exec(text)) !== null) {
    lastEnd = mm.index + mm[0].length;
  }
  const inject = "\nfrom omegaconf import OmegaConf";
  changes.push(
    "Add `from omegaconf import OmegaConf` (needed for the wrap calls above).",
  );
  if (lastEnd < 0) return inject.trimStart() + "\n\n" + text;
  return text.slice(0, lastEnd) + inject + text.slice(lastEnd);
}

/**
 * Find a kwarg like `config=<expr>` at the top level of an arg list.
 * Returns the indices into `inner` where the expression starts/ends,
 * or null if not present at top level.
 */
function extractKwargExpr(
  inner: string,
  name: string,
): { expr: string; exprStart: number; exprEnd: number } | null {
  const re = new RegExp(`(?:^|,)\\s*${name}\\s*=`, "g");
  const m = re.exec(inner);
  if (!m) return null;
  const eqIdx = inner.indexOf("=", m.index);
  if (eqIdx < 0) return null;
  // Skip past whitespace after `=`.
  let i = eqIdx + 1;
  while (i < inner.length && /\s/.test(inner[i]!)) i++;
  const exprStart = i;
  // Walk until top-level comma or end of string.
  let depthParen = 0,
    depthBracket = 0,
    depthBrace = 0;
  while (i < inner.length) {
    const c = inner[i]!;
    if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (
      c === "," &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0
    )
      break;
    i++;
  }
  const exprEnd = i;
  const expr = inner.slice(exprStart, exprEnd);
  return { expr, exprStart, exprEnd };
}

function findMatchingParen(text: string, openIdx: number): number {
  if (text[openIdx] !== "(") return -1;
  let depth = 1;
  let inString: false | '"' | "'" | "'''" | '"""' = false;
  let i = openIdx + 1;
  while (i < text.length) {
    const c = text[i]!;
    if (inString) {
      if (typeof inString === "string" && inString.length === 1) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === inString) inString = false;
      } else if (text.slice(i, i + 3) === inString) {
        i += 3;
        inString = false;
        continue;
      }
      i++;
      continue;
    } else {
      if (text.slice(i, i + 3) === '"""' || text.slice(i, i + 3) === "'''") {
        inString = text.slice(i, i + 3) as '"""' | "'''";
        i += 3;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = c;
        i++;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    i++;
  }
  return -1;
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface WireProposal {
  proposalId: string;
  kind: "wandb-hydra";
  detected: {
    hydra: boolean;
    wandb: boolean;
    hydraSignals: string[];
    wandbSignals: string[];
  };
  patches: WirePatch[];
  notes: string[];
}

export async function detectAndWireWandbHydra(
  repoPath: string,
): Promise<WireProposal | null> {
  const files = await walkPyFiles(repoPath);

  // First pass: collect signals across files.
  const hydraSignals: string[] = [];
  const wandbSignals: string[] = [];
  const fileTexts = new Map<string, string>();
  const fileSigs = new Map<string, FileSignals>();
  for (const f of files) {
    const text = await readFile(f, "utf8");
    fileTexts.set(f, text);
    const sig = scanFileSignals(text);
    fileSigs.set(f, sig);
    const rel = relative(repoPath, f);
    if (sig.hasHydraMain) hydraSignals.push(`${rel}:@hydra.main`);
    if (sig.hasOmegaConf && !sig.hasHydraMain)
      hydraSignals.push(`${rel}:OmegaConf`);
    if (sig.hasWandbInit) wandbSignals.push(`${rel}:wandb.init`);
    if (sig.hasWandbConfigUpdate)
      wandbSignals.push(`${rel}:wandb.config.update`);
  }
  // Hydra also signaled by a `conf/` directory with at least one yaml.
  const confDir = join(repoPath, "conf");
  if (await isDir(confDir)) {
    const ents = await readdir(confDir).catch(() => []);
    if (ents.some((n) => n.endsWith(".yaml") || n.endsWith(".yml"))) {
      hydraSignals.push("conf/*.yaml");
    }
  }

  const hydra = hydraSignals.length > 0;
  const wandb = wandbSignals.length > 0;
  if (!wandb) return null; // nothing to wire

  // Second pass: produce patches for every .py file that uses W&B.
  const patches: WirePatch[] = [];
  for (const f of files) {
    const sig = fileSigs.get(f)!;
    if (!sig.hasWandbInit && !sig.hasWandbConfigUpdate) continue;
    const oldText = fileTexts.get(f)!;
    const patched = patchWandbHydraFile(oldText);
    if (!patched) continue;
    patches.push({
      path: relative(repoPath, f),
      oldText,
      newText: patched.newText,
      changes: patched.changes,
    });
  }

  if (patches.length === 0) return null;

  const notes: string[] = [];
  if (hydra && wandb) {
    notes.push(
      "Detected the canonical Hydra + W&B setup — both libraries in use, multiple call sites of `wandb.init`/`wandb.config`.",
    );
  } else if (wandb && !hydra) {
    notes.push(
      "Detected W&B usage. No Hydra-specific signals found, so only the `start_method=\"thread\"` fix is applied (it's still good practice).",
    );
  }
  notes.push(
    `Touches ${patches.length} file(s). Nothing is written until you accept.`,
  );

  return {
    proposalId: randomUUID(),
    kind: "wandb-hydra",
    detected: { hydra, wandb, hydraSignals, wandbSignals },
    patches,
    notes,
  };
}

export async function applyWirePatches(
  repoPath: string,
  patches: WirePatch[],
): Promise<{ written: string[]; errors: string[] }> {
  const written: string[] = [];
  const errors: string[] = [];
  for (const p of patches) {
    const abs = join(repoPath, p.path);
    try {
      await writeFile(abs, p.newText, "utf8");
      written.push(p.path);
    } catch (err) {
      errors.push(`${p.path}: ${String(err instanceof Error ? err.message : err)}`);
    }
  }
  return { written, errors };
}
