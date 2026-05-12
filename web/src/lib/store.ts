import { create } from "zustand";
import type { Attempt, Run, RunLogEntry, Session } from "@shared/protocol";

export type View =
  | { kind: "home" }
  | { kind: "session"; id: string };

interface AppState {
  view: View;

  sessions: Map<string, Session>;
  attemptsBySession: Map<string, Map<string, Attempt>>;
  runsByAttempt: Map<string, Map<string, Run>>;
  // Cap each run's logs at LOG_CAP entries to avoid unbounded growth.
  logsByRun: Map<string, RunLogEntry[]>;

  // Navigation
  goHome: () => void;
  openSession: (id: string) => void;

  // Session updates
  upsertSession: (s: Session) => void;
  upsertManySessions: (s: Session[]) => void;

  // Attempt updates
  upsertAttempt: (a: Attempt) => void;
  upsertManyAttempts: (a: Attempt[]) => void;

  // Run updates
  upsertRun: (r: Run) => void;
  upsertManyRuns: (r: Run[]) => void;
  appendLog: (entry: RunLogEntry) => void;
  appendManyLogs: (entries: RunLogEntry[]) => void;
}

const LOG_CAP = 5_000;

export const useAppStore = create<AppState>((set) => ({
  view: { kind: "home" },
  sessions: new Map(),
  attemptsBySession: new Map(),
  runsByAttempt: new Map(),
  logsByRun: new Map(),

  goHome: () => set({ view: { kind: "home" } }),
  openSession: (id) => set({ view: { kind: "session", id } }),

  upsertSession: (s) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.set(s.id, s);
      return { sessions: next };
    }),
  upsertManySessions: (list) =>
    set((state) => {
      const next = new Map(state.sessions);
      for (const s of list) next.set(s.id, s);
      return { sessions: next };
    }),

  upsertAttempt: (a) =>
    set((state) => {
      const next = new Map(state.attemptsBySession);
      const inner = new Map(next.get(a.sessionId) ?? []);
      inner.set(a.id, a);
      next.set(a.sessionId, inner);
      return { attemptsBySession: next };
    }),
  upsertManyAttempts: (list) =>
    set((state) => {
      const next = new Map(state.attemptsBySession);
      for (const a of list) {
        const inner = new Map(next.get(a.sessionId) ?? []);
        inner.set(a.id, a);
        next.set(a.sessionId, inner);
      }
      return { attemptsBySession: next };
    }),

  upsertRun: (r) =>
    set((state) => {
      const next = new Map(state.runsByAttempt);
      const inner = new Map(next.get(r.attemptId) ?? []);
      inner.set(r.id, r);
      next.set(r.attemptId, inner);
      return { runsByAttempt: next };
    }),
  upsertManyRuns: (list) =>
    set((state) => {
      const next = new Map(state.runsByAttempt);
      for (const r of list) {
        const inner = new Map(next.get(r.attemptId) ?? []);
        inner.set(r.id, r);
        next.set(r.attemptId, inner);
      }
      return { runsByAttempt: next };
    }),

  appendLog: (entry) =>
    set((state) => {
      const next = new Map(state.logsByRun);
      const prev = next.get(entry.runId) ?? [];
      const updated = [...prev, entry];
      if (updated.length > LOG_CAP) updated.splice(0, updated.length - LOG_CAP);
      next.set(entry.runId, updated);
      return { logsByRun: next };
    }),
  appendManyLogs: (entries) =>
    set((state) => {
      const next = new Map(state.logsByRun);
      const grouped = new Map<string, RunLogEntry[]>();
      for (const e of entries) {
        const list = grouped.get(e.runId) ?? [];
        list.push(e);
        grouped.set(e.runId, list);
      }
      for (const [runId, list] of grouped) {
        const prev = next.get(runId) ?? [];
        const updated = [...prev, ...list];
        if (updated.length > LOG_CAP)
          updated.splice(0, updated.length - LOG_CAP);
        next.set(runId, updated);
      }
      return { logsByRun: next };
    }),
}));

export function sessionsByRecency(map: Map<string, Session>): Session[] {
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function attemptsForSession(
  state: AppState,
  sessionId: string,
): Attempt[] {
  const inner = state.attemptsBySession.get(sessionId);
  if (!inner) return [];
  return [...inner.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function runsForAttempt(
  state: AppState,
  attemptId: string,
): Run[] {
  const inner = state.runsByAttempt.get(attemptId);
  if (!inner) return [];
  return [...inner.values()].sort((a, b) => a.createdAt - b.createdAt);
}
