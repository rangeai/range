import { create } from "zustand";
import type {
  AgentItem,
  Attempt,
  ProfileLoadResult,
  Run,
  RunLogEntry,
  Session,
} from "@shared/protocol";

export type ConversationEntry =
  | { kind: "user"; text: string; t: number }
  | { kind: "agent_item"; item: AgentItem; t: number }
  | { kind: "system"; text: string; t: number };

export interface ConversationState {
  status: "stopped" | "starting" | "running" | "error";
  threadId: string | null;
  turnInFlight: boolean;
  error: string | null;
  entries: ConversationEntry[];
}

function emptyConversation(): ConversationState {
  return {
    status: "stopped",
    threadId: null,
    turnInFlight: false,
    error: null,
    entries: [],
  };
}

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
  profilesBySession: Map<string, ProfileLoadResult>;
  conversationsByAttempt: Map<string, ConversationState>;

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

  // Profile
  setProfile: (sessionId: string, result: ProfileLoadResult) => void;

  // Conversation
  patchConversation: (
    attemptId: string,
    patch: Partial<ConversationState>,
  ) => void;
  pushUserMessage: (attemptId: string, text: string) => void;
  pushSystemEntry: (attemptId: string, text: string) => void;
  applyAgentItem: (attemptId: string, item: AgentItem) => void;
  applyMessageDelta: (
    attemptId: string,
    itemId: string,
    delta: string,
  ) => void;
}

const LOG_CAP = 5_000;

export const useAppStore = create<AppState>((set) => ({
  view: { kind: "home" },
  sessions: new Map(),
  attemptsBySession: new Map(),
  runsByAttempt: new Map(),
  logsByRun: new Map(),
  profilesBySession: new Map(),
  conversationsByAttempt: new Map(),

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

  setProfile: (sessionId, result) =>
    set((state) => {
      const next = new Map(state.profilesBySession);
      next.set(sessionId, result);
      return { profilesBySession: next };
    }),

  patchConversation: (attemptId, patch) =>
    set((state) => {
      const next = new Map(state.conversationsByAttempt);
      const prev = next.get(attemptId) ?? emptyConversation();
      next.set(attemptId, { ...prev, ...patch });
      return { conversationsByAttempt: next };
    }),

  pushUserMessage: (attemptId, text) =>
    set((state) => {
      const next = new Map(state.conversationsByAttempt);
      const prev = next.get(attemptId) ?? emptyConversation();
      next.set(attemptId, {
        ...prev,
        entries: [
          ...prev.entries,
          { kind: "user", text, t: Date.now() },
        ],
        turnInFlight: true,
      });
      return { conversationsByAttempt: next };
    }),

  pushSystemEntry: (attemptId, text) =>
    set((state) => {
      const next = new Map(state.conversationsByAttempt);
      const prev = next.get(attemptId) ?? emptyConversation();
      next.set(attemptId, {
        ...prev,
        entries: [
          ...prev.entries,
          { kind: "system", text, t: Date.now() },
        ],
      });
      return { conversationsByAttempt: next };
    }),

  applyAgentItem: (attemptId, item) =>
    set((state) => {
      const next = new Map(state.conversationsByAttempt);
      const prev = next.get(attemptId) ?? emptyConversation();
      // If we already have an agent_item with this id, replace it
      // (handles started → updated → completed lifecycle).
      const idx = prev.entries.findIndex(
        (e) => e.kind === "agent_item" && e.item.id === item.id,
      );
      const entry: ConversationEntry = {
        kind: "agent_item",
        item,
        t: Date.now(),
      };
      let entries: ConversationEntry[];
      if (idx >= 0) {
        entries = prev.entries.slice();
        entries[idx] = entry;
      } else {
        entries = [...prev.entries, entry];
      }
      next.set(attemptId, { ...prev, entries });
      return { conversationsByAttempt: next };
    }),

  applyMessageDelta: (attemptId, itemId, delta) =>
    set((state) => {
      const next = new Map(state.conversationsByAttempt);
      const prev = next.get(attemptId) ?? emptyConversation();
      const idx = prev.entries.findIndex(
        (e) => e.kind === "agent_item" && e.item.id === itemId,
      );
      let entries = prev.entries;
      if (idx >= 0) {
        const existing = entries[idx]!;
        if (
          existing.kind === "agent_item" &&
          (existing.item.kind === "message" ||
            existing.item.kind === "reasoning")
        ) {
          const updatedItem: AgentItem = {
            ...existing.item,
            text: (existing.item.text ?? "") + delta,
          };
          entries = entries.slice();
          entries[idx] = {
            ...existing,
            item: updatedItem,
          };
        }
      } else {
        // No matching item yet — synthesize a streaming message item.
        entries = [
          ...entries,
          {
            kind: "agent_item",
            t: Date.now(),
            item: {
              id: itemId,
              kind: "message",
              state: "started",
              text: delta,
            },
          },
        ];
      }
      next.set(attemptId, { ...prev, entries });
      return { conversationsByAttempt: next };
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
