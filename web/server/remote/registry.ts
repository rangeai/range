/**
 * Per-session registry of live RemoteProvider + EnvironmentHandle
 * pairs. Populated by the agent backend when it provisions a remote
 * (currently only codex.ts), read by any other module that wants to
 * run commands on the same remote — typically runner.ts spawning
 * scenarios.
 *
 * One entry per session, lifetime is bounded by the agent backend's
 * teardown.
 */

import type {
  EnvironmentHandle,
  Machine,
  RemoteProvider,
} from "./provider.ts";

export interface SessionRemoteEntry {
  provider: RemoteProvider;
  machine: Machine;
  env: EnvironmentHandle;
}

const entries = new Map<string, SessionRemoteEntry>();

export function setSessionRemote(
  sessionId: string,
  entry: SessionRemoteEntry,
): void {
  entries.set(sessionId, entry);
}

export function getSessionRemote(
  sessionId: string,
): SessionRemoteEntry | null {
  return entries.get(sessionId) ?? null;
}

export function clearSessionRemote(sessionId: string): void {
  entries.delete(sessionId);
}
