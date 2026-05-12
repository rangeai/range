import { create } from "zustand";
import type { Session } from "@shared/protocol";

export type View =
  | { kind: "home" }
  | { kind: "session"; id: string };

interface AppState {
  view: View;
  sessions: Map<string, Session>;
  goHome: () => void;
  openSession: (id: string) => void;
  upsertSession: (s: Session) => void;
  upsertMany: (s: Session[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: { kind: "home" },
  sessions: new Map(),
  goHome: () => set({ view: { kind: "home" } }),
  openSession: (id) => set({ view: { kind: "session", id } }),
  upsertSession: (s) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.set(s.id, s);
      return { sessions: next };
    }),
  upsertMany: (list) =>
    set((state) => {
      const next = new Map(state.sessions);
      for (const s of list) next.set(s.id, s);
      return { sessions: next };
    }),
}));

export function sessionsByRecency(map: Map<string, Session>): Session[] {
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
