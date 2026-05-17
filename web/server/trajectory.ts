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
import { readFile, access } from "node:fs/promises";
import { getRun } from "./runs.ts";

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
  const path = join(run.runDir, "events.jsonl");
  try {
    await access(path);
  } catch {
    throw new Error(`no events.jsonl at ${path}`);
  }
  const text = await readFile(path, "utf8");
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
