/**
 * Trajectory inspection — reads a run's `events.jsonl`, walks the
 * trajectory ticks (filtering out Range's own runner-state events),
 * and reports the first NaN/Inf occurrence + surrounding context.
 *
 * Same logic the CLI's `range trajectory inspect` uses, exposed
 * server-side so the `/investigate` slash builtin can fetch a
 * structured report and feed it into a Codex kickoff prompt.
 */

import { join } from "node:path";
import { getRun } from "./runs.ts";
import { readRunArtifactText } from "./remote/registry.ts";
import { readRunEvents } from "./runner.ts";

const SPECIAL_RE = /\b(NaN|-Infinity|Infinity)\b/g;
const SPECIAL_MARKER_RE = /"__SPECIAL_(NaN|-Infinity|Infinity)__"/g;

export interface TrajectoryInspectReport {
  runId: string;
  runDir: string;
  totalTicks: number;
  cleanTicks: number;
  contaminatedTicks: number;
  firstHit: { tick: number; t: number; fields: string[] } | null;
  /** Up to N most recent clean trajectory ticks before contamination
   *  (or the most recent N if cleans come after contaminations). */
  lastCleanContext: Record<string, unknown>[];
  /** First N contaminated trajectory ticks. */
  contaminatedContext: Record<string, unknown>[];
}

function parseEventLine(line: string): Record<string, unknown> | null {
  const normalized = line.replace(SPECIAL_RE, (m) => `"__SPECIAL_${m}__"`);
  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTrajectoryTick(obj: Record<string, unknown>): boolean {
  return typeof obj.t === "number" && Array.isArray(obj.pose);
}

function findSpecialFields(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v.startsWith("__SPECIAL_")) {
      out.push(k);
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const c = v[i];
        if (typeof c === "string" && c.startsWith("__SPECIAL_")) {
          out.push(`${k}[${i}]`);
        }
      }
    }
  }
  return out;
}

export function prettyPrintEvent(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(SPECIAL_MARKER_RE, (_, kind) =>
    String(kind),
  );
}

export async function inspectTrajectory(
  runId: string,
  contextSize = 5,
): Promise<TrajectoryInspectReport> {
  const run = getRun(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  const localPath = join(run.runDir, "events.jsonl");
  // Local sessions: reads from local FS. Remote sessions: cats the
  // file off the remote box via the session's EnvironmentHandle —
  // the scenario wrote there, not to the local run dir.
  let text: string;
  try {
    text = await readRunArtifactText({
      sessionId: run.sessionId,
      runId,
      filename: "events.jsonl",
      localPath,
    });
  } catch (err) {
    throw new Error(
      `failed to read events.jsonl for run ${runId}: ${err instanceof Error ? err.message : err}`,
    );
  }
  const lines = text.split("\n").filter((l) => l.length > 0);

  let firstHit: TrajectoryInspectReport["firstHit"] = null;
  const lastCleanRing: Record<string, unknown>[] = [];
  const contaminatedSample: Record<string, unknown>[] = [];
  let contaminated = 0;
  let clean = 0;
  let tickIdx = 0;

  for (const line of lines) {
    const obj = parseEventLine(line);
    if (!obj || !isTrajectoryTick(obj)) continue;
    const specials = findSpecialFields(obj);
    if (specials.length === 0) {
      clean++;
      lastCleanRing.push(obj);
      if (lastCleanRing.length > contextSize) lastCleanRing.shift();
    } else {
      contaminated++;
      if (firstHit === null) {
        firstHit = {
          tick: tickIdx,
          t: typeof obj.t === "number" ? (obj.t as number) : -1,
          fields: specials,
        };
      }
      if (contaminatedSample.length < contextSize)
        contaminatedSample.push(obj);
    }
    tickIdx++;
  }

  return {
    runId,
    runDir: run.runDir,
    totalTicks: clean + contaminated,
    cleanTicks: clean,
    contaminatedTicks: contaminated,
    firstHit,
    lastCleanContext: lastCleanRing,
    contaminatedContext: contaminatedSample,
  };
}

/**
 * Format an inspection report as a markdown block suitable for
 * dropping into a Codex prompt. Codex sees structured headers,
 * pretty-printed NaN markers, and a clear directive to investigate.
 */
export function formatReportForCodex(
  report: TrajectoryInspectReport,
  scenarioName: string | null,
): string {
  const lines: string[] = [];
  lines.push(
    `# Trajectory inspection — run \`${report.runId}\`${scenarioName ? ` (scenario: ${scenarioName})` : ""}`,
  );
  lines.push("");
  lines.push(
    `- trajectory ticks: **${report.totalTicks}** (${report.cleanTicks} clean, ${report.contaminatedTicks} contaminated)`,
  );
  if (report.firstHit) {
    lines.push(
      `- first NaN/Inf: tick **${report.firstHit.tick}**, t=${report.firstHit.t.toFixed(3)}s`,
    );
    lines.push(`- affected fields: \`${report.firstHit.fields.join(", ")}\``);
  } else {
    lines.push("- no NaN/Inf detected — trajectory is clean.");
    return lines.join("\n");
  }

  if (report.lastCleanContext.length > 0) {
    lines.push("");
    lines.push("**Last clean tick(s) before contamination:**");
    lines.push("```");
    for (const o of report.lastCleanContext) lines.push(prettyPrintEvent(o));
    lines.push("```");
  }
  lines.push("");
  lines.push("**First contaminated tick(s):**");
  lines.push("```");
  for (const o of report.contaminatedContext) lines.push(prettyPrintEvent(o));
  lines.push("```");

  return lines.join("\n");
}

// ─── Fallback: log-based investigation when no events.jsonl ───────────────

/**
 * The frameworks Range supports today (Brax/Playground, SB3, CleanRL,
 * PureJaxRL, custom) all log to stdout/stderr but few of them emit the
 * per-tick events.jsonl format the trajectory scrubber expects. When
 * inspectTrajectory() comes back empty, we still want /investigate to
 * be useful — so we fall back to summarizing the run's stdout/stderr
 * + run metadata and handing Codex a focused-attention prompt.
 */
export interface RunLogReport {
  runId: string;
  scenarioName: string | null;
  command: string[];
  cwd: string;
  state: string;
  exitCode: number | null;
  durationMs: number | null;
  /** Last N lines of run log (stderr first, then stdout). */
  tail: Array<{ stream: string; message: string }>;
  /** File paths the log itself mentions — usually the next place to
   *  read. Best-effort regex over the tail. */
  mentionedFiles: string[];
  /** "looks-like" heuristic: does the tail contain markers of a NaN/Inf
   *  failure, a Python traceback, a non-zero exit, etc.? */
  symptoms: string[];
}

const PY_TRACEBACK_FILE_RE = /File "([^"]+)", line (\d+)/g;
const GENERIC_PATH_RE = /(\/[\w./-]+\.py)\b/g;

export async function inspectRunLogs(
  runId: string,
  tailLines = 80,
): Promise<RunLogReport> {
  const run = getRun(runId);
  if (!run) throw new Error(`run not found: ${runId}`);

  const events = await readRunEvents(runId, 256 * 1024);
  // readRunEvents returns ServerRunLog events (newest at the end after
  // tailing). Take the last `tailLines`.
  const tail = events
    .filter((e) => e.stream === "stdout" || e.stream === "stderr")
    .slice(-tailLines)
    .map((e) => ({ stream: e.stream, message: e.message }));

  const tailText = tail.map((t) => t.message).join("\n");
  const mentionedFiles = new Set<string>();
  for (const m of tailText.matchAll(PY_TRACEBACK_FILE_RE)) {
    mentionedFiles.add(m[1]);
  }
  for (const m of tailText.matchAll(GENERIC_PATH_RE)) {
    mentionedFiles.add(m[1]);
  }

  const symptoms: string[] = [];
  if (/\bnan\b|invalid value|RuntimeWarning/i.test(tailText)) {
    symptoms.push("NaN/Inf or invalid-value warning in output");
  }
  if (/Traceback \(most recent call last\)/.test(tailText)) {
    symptoms.push("Python traceback present");
  }
  if (/AssertionError|assert/.test(tailText)) {
    symptoms.push("AssertionError raised");
  }
  if (run.state === "failed" || (run.exitCode !== null && run.exitCode !== 0)) {
    symptoms.push(
      `non-zero exit (${run.state}${run.exitCode !== null ? `, code ${run.exitCode}` : ""})`,
    );
  }

  return {
    runId,
    scenarioName: run.scenarioName ?? null,
    command: run.command,
    cwd: run.cwd,
    state: run.state,
    exitCode: run.exitCode,
    durationMs:
      run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null,
    tail,
    mentionedFiles: [...mentionedFiles],
    symptoms,
  };
}

/**
 * Format the log-based report as a Codex-friendly prompt. Same shape
 * as formatReportForCodex but optimized for "no per-tick data, here's
 * stderr + a reading list."
 */
export function formatLogReportForCodex(
  report: RunLogReport,
  repoPath: string | null,
): string {
  const lines: string[] = [];
  lines.push(
    `# Run failure — \`${report.runId}\`${report.scenarioName ? ` (scenario: ${report.scenarioName})` : ""}`,
  );
  lines.push("");
  lines.push(`- command: \`${report.command.join(" ")}\``);
  lines.push(`- cwd: \`${report.cwd}\``);
  lines.push(
    `- state: **${report.state}**${report.exitCode !== null ? ` (exit ${report.exitCode})` : ""}${report.durationMs ? ` after ${(report.durationMs / 1000).toFixed(1)}s` : ""}`,
  );
  if (report.symptoms.length > 0) {
    lines.push(`- symptoms: ${report.symptoms.map((s) => `**${s}**`).join(", ")}`);
  }
  if (repoPath) lines.push(`- repo: \`${repoPath}\``);
  lines.push("");

  if (report.mentionedFiles.length > 0) {
    lines.push("**Files the log mentions** (read these first):");
    for (const f of report.mentionedFiles.slice(0, 10)) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  lines.push("**Last log lines:**");
  lines.push("```");
  for (const t of report.tail) {
    lines.push(`[${t.stream}] ${t.message}`);
  }
  lines.push("```");
  lines.push("");
  lines.push(
    "Find the root cause. Read the relevant source files (the cwd + repo are above; the files the log mentions are the obvious starting points). Propose a focused fix. Don't try to re-run the training — just identify the bug.",
  );

  return lines.join("\n");
}
