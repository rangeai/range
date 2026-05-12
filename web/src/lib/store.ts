import { create } from "zustand";
import type { Attempt, Session } from "@shared/protocol";

export type View =
  | { kind: "home" }
  | { kind: "session"; id: string };

interface AppState {
  view: View;

  sessions: Map<string, Session>;
  attemptsBySession: Map<string, Map<string, Attempt>>;

  // Navigation
  goHome: () => void;
  openSession: (id: string) => void;

  // Session updates
  upsertSession: (s: Session) => void;
  upsertManySessions: (s: Session[]) => void;

  // Attempt updates
  upsertAttempt: (a: Attempt) => void;
  upsertManyAttempts: (a: Attempt[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: { kind: "home" },
  sessions: new Map(),
  attemptsBySession: new Map(),

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
