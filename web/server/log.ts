/**
 * Tiny structured logger. Replace with a real one later if needed.
 *
 * Keeps allocations low by avoiding string interpolation when level is filtered.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (Bun.env.RANGE_LOG_LEVEL ?? "info") as Level;
const minPriority = LEVEL_PRIORITY[envLevel] ?? 20;

function emit(
  level: Level,
  scope: string,
  msg: string,
  data?: Record<string, unknown>,
) {
  if (LEVEL_PRIORITY[level] < minPriority) return;
  const ts = new Date().toISOString();
  const line = data
    ? `${ts} ${level.padEnd(5)} [${scope}] ${msg} ${JSON.stringify(data)}`
    : `${ts} ${level.padEnd(5)} [${scope}] ${msg}`;
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (scope: string, msg: string, data?: Record<string, unknown>) =>
    emit("debug", scope, msg, data),
  info: (scope: string, msg: string, data?: Record<string, unknown>) =>
    emit("info", scope, msg, data),
  warn: (scope: string, msg: string, data?: Record<string, unknown>) =>
    emit("warn", scope, msg, data),
  error: (scope: string, msg: string, data?: Record<string, unknown>) =>
    emit("error", scope, msg, data),
};
