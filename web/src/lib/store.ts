import { create } from "zustand";
import type {
  AgentItem,
  ArtifactInfo,
  ProfileLoadResult,
  Run,
  RunLogEntry,
  ServerAgentApprovalRequest,
  Session,
  ThreadTokenUsage,
  VerificationResult,
} from "@shared/protocol";

export interface PendingApproval {
  requestId: number;
  kind: ServerAgentApprovalRequest["kind"];
  payload: ServerAgentApprovalRequest["payload"];
  decision: "accept" | "decline" | null;
}

export type View =
  | { kind: "home" }
  | { kind: "session"; id: string };

export interface PrDraftEntryState {
  draftId: string;
  initialTitle: string;
  initialBody: string;
  base: string;
  commitCount: number;
  filesChanged: string[];
  status: "draft" | "opening" | "opened" | "discarded" | "error";
  url?: string;
  error?: string;
}

export type ConversationEntry =
  | { kind: "user"; text: string; t: number }
  | { kind: "agent_item"; item: AgentItem; t: number }
  | { kind: "approval"; approval: PendingApproval; t: number }
  | { kind: "system"; text: string; t: number }
  | { kind: "run"; runId: string; t: number }
  | { kind: "sweep"; sweepId: string; t: number }
  | { kind: "pr_draft"; pr: PrDraftEntryState; t: number };

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

interface AppState {
  view: View;

  sessions: Map<string, Session>;
  runsBySession: Map<string, Map<string, Run>>;
  logsByRun: Map<string, RunLogEntry[]>;
  artifactsByRun: Map<string, ArtifactInfo[]>;
  profilesBySession: Map<string, ProfileLoadResult>;
  conversationsBySession: Map<string, ConversationState>;
  verificationBySession: Map<string, Map<string, VerificationResult>>;
  tokenUsageBySession: Map<string, ThreadTokenUsage>;
  lastTurnDiffBySession: Map<string, string>;

  goHome: () => void;
  openSession: (id: string) => void;

  upsertSession: (s: Session) => void;
  upsertManySessions: (s: Session[]) => void;
  removeSession: (id: string) => void;

  upsertRun: (r: Run) => void;
  upsertManyRuns: (r: Run[]) => void;
  applyRunMetrics: (
    sessionId: string,
    runId: string,
    metrics: import("@shared/protocol").MetricsSnapshot,
  ) => void;
  setRunArtifacts: (runId: string, artifacts: ArtifactInfo[]) => void;
  /** Push a `run` or `sweep` entry into the session's conversation.
   *  Solo runs get a `run` entry. Runs that belong to a sweep get a
   *  single `sweep` entry per sweepId (subsequent runs in the same
   *  sweep are folded into that one entry at render time). */
  appendRunToConversation: (sessionId: string, run: Run) => void;

  pushPrDraft: (sessionId: string, draft: PrDraftEntryState) => void;
  updatePrDraft: (
    sessionId: string,
    draftId: string,
    patch: Partial<PrDraftEntryState>,
  ) => void;
  appendLog: (entry: RunLogEntry) => void;
  appendManyLogs: (entries: RunLogEntry[]) => void;

  setProfile: (sessionId: string, result: ProfileLoadResult) => void;

  patchConversation: (
    sessionId: string,
    patch: Partial<ConversationState>,
  ) => void;
  pushUserMessage: (sessionId: string, text: string) => void;
  pushSystemEntry: (sessionId: string, text: string) => void;
  applyAgentItem: (sessionId: string, item: AgentItem) => void;
  applyMessageDelta: (
    sessionId: string,
    itemId: string,
    delta: string,
  ) => void;
  appendApproval: (
    sessionId: string,
    approval: PendingApproval,
  ) => void;
  resolveApproval: (
    sessionId: string,
    requestId: number,
    decision: "accept" | "decline",
  ) => void;

  applyVerificationResult: (result: VerificationResult) => void;
  setVerificationResults: (
    sessionId: string,
    results: VerificationResult[],
  ) => void;
  /** Reset the conversation timeline for a session (used by /clear).
   *  Preserves runs / artifacts / verification — only the chat
   *  entries are wiped. */
  clearConversation: (sessionId: string) => void;

  setTokenUsage: (sessionId: string, usage: ThreadTokenUsage) => void;
  setTurnDiff: (sessionId: string, diff: string) => void;
}

const LOG_CAP = 5_000;

export const useAppStore = create<AppState>((set) => ({
  view: { kind: "home" },
  sessions: new Map(),
  runsBySession: new Map(),
  logsByRun: new Map(),
  artifactsByRun: new Map(),
  profilesBySession: new Map(),
  conversationsBySession: new Map(),
  verificationBySession: new Map(),
  tokenUsageBySession: new Map(),
  lastTurnDiffBySession: new Map(),

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
  removeSession: (id) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(id);
      const runsBySession = new Map(state.runsBySession);
      runsBySession.delete(id);
      const profilesBySession = new Map(state.profilesBySession);
      profilesBySession.delete(id);
      const conversationsBySession = new Map(state.conversationsBySession);
      conversationsBySession.delete(id);
      const verificationBySession = new Map(state.verificationBySession);
      verificationBySession.delete(id);
      const view =
        state.view.kind === "session" && state.view.id === id
          ? ({ kind: "home" } as const)
          : state.view;
      return {
        sessions,
        runsBySession,
        profilesBySession,
        conversationsBySession,
        verificationBySession,
        view,
      };
    }),

  upsertRun: (r) =>
    set((state) => {
      const next = new Map(state.runsBySession);
      const inner = new Map(next.get(r.sessionId) ?? []);
      inner.set(r.id, r);
      next.set(r.sessionId, inner);
      return { runsBySession: next };
    }),
  pushPrDraft: (sessionId, draft) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
      next.set(sessionId, {
        ...prev,
        entries: [
          ...prev.entries,
          { kind: "pr_draft", pr: draft, t: Date.now() },
        ],
      });
      return { conversationsBySession: next };
    }),
  updatePrDraft: (sessionId, draftId, patch) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId);
      if (!prev) return {};
      let changed = false;
      const entries = prev.entries.map((e) => {
        if (e.kind === "pr_draft" && e.pr.draftId === draftId) {
          changed = true;
          return { ...e, pr: { ...e.pr, ...patch } };
        }
        return e;
      });
      if (!changed) return {};
      next.set(sessionId, { ...prev, entries });
      return { conversationsBySession: next };
    }),
  appendRunToConversation: (sessionId, run) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
      // Solo run → push a `run` entry if not already there.
      if (!run.sweepId) {
        if (prev.entries.some((e) => e.kind === "run" && e.runId === run.id)) {
          return {};
        }
        next.set(sessionId, {
          ...prev,
          entries: [
            ...prev.entries,
            { kind: "run", runId: run.id, t: run.createdAt },
          ],
        });
        return { conversationsBySession: next };
      }
      // Sweep run → push a `sweep` entry once per sweepId.
      if (
        prev.entries.some(
          (e) => e.kind === "sweep" && e.sweepId === run.sweepId,
        )
      ) {
        return {};
      }
      next.set(sessionId, {
        ...prev,
        entries: [
          ...prev.entries,
          { kind: "sweep", sweepId: run.sweepId, t: run.createdAt },
        ],
      });
      return { conversationsBySession: next };
    }),
  upsertManyRuns: (list) =>
    set((state) => {
      const next = new Map(state.runsBySession);
      for (const r of list) {
        const inner = new Map(next.get(r.sessionId) ?? []);
        inner.set(r.id, r);
        next.set(r.sessionId, inner);
      }
      return { runsBySession: next };
    }),
  applyRunMetrics: (sessionId, runId, metrics) =>
    set((state) => {
      const next = new Map(state.runsBySession);
      const inner = new Map(next.get(sessionId) ?? []);
      const prev = inner.get(runId);
      if (!prev) return {};
      inner.set(runId, { ...prev, metrics });
      next.set(sessionId, inner);
      return { runsBySession: next };
    }),
  setRunArtifacts: (runId, artifacts) =>
    set((state) => {
      const next = new Map(state.artifactsByRun);
      next.set(runId, artifacts);
      return { artifactsByRun: next };
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

  patchConversation: (sessionId, patch) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
      next.set(sessionId, { ...prev, ...patch });
      return { conversationsBySession: next };
    }),

  pushUserMessage: (sessionId, text) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
      next.set(sessionId, {
        ...prev,
        entries: [
          ...prev.entries,
          { kind: "user", text, t: Date.now() },
        ],
        turnInFlight: true,
      });
      return { conversationsBySession: next };
    }),

  pushSystemEntry: (sessionId, text) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
      next.set(sessionId, {
        ...prev,
        entries: [
          ...prev.entries,
          { kind: "system", text, t: Date.now() },
        ],
      });
      return { conversationsBySession: next };
    }),

  applyAgentItem: (sessionId, item) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
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
      next.set(sessionId, { ...prev, entries });
      return { conversationsBySession: next };
    }),

  appendApproval: (sessionId, approval) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
      next.set(sessionId, {
        ...prev,
        entries: [
          ...prev.entries,
          { kind: "approval", approval, t: Date.now() },
        ],
      });
      return { conversationsBySession: next };
    }),

  resolveApproval: (sessionId, requestId, decision) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
      const entries = prev.entries.map((e) =>
        e.kind === "approval" && e.approval.requestId === requestId
          ? { ...e, approval: { ...e.approval, decision } }
          : e,
      );
      next.set(sessionId, { ...prev, entries });
      return { conversationsBySession: next };
    }),

  applyVerificationResult: (result) =>
    set((state) => {
      const next = new Map(state.verificationBySession);
      const inner = new Map(next.get(result.sessionId) ?? []);
      inner.set(result.gateName, result);
      next.set(result.sessionId, inner);
      return { verificationBySession: next };
    }),
  setVerificationResults: (sessionId, results) =>
    set((state) => {
      const next = new Map(state.verificationBySession);
      const inner = new Map<string, VerificationResult>();
      for (const r of results) inner.set(r.gateName, r);
      next.set(sessionId, inner);
      return { verificationBySession: next };
    }),

  clearConversation: (sessionId) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId);
      if (!prev) return {};
      next.set(sessionId, { ...prev, entries: [], error: null });
      return { conversationsBySession: next };
    }),

  setTokenUsage: (sessionId, usage) =>
    set((state) => {
      const next = new Map(state.tokenUsageBySession);
      next.set(sessionId, usage);
      return { tokenUsageBySession: next };
    }),

  setTurnDiff: (sessionId, diff) =>
    set((state) => {
      const next = new Map(state.lastTurnDiffBySession);
      next.set(sessionId, diff);
      return { lastTurnDiffBySession: next };
    }),

  applyMessageDelta: (sessionId, itemId, delta) =>
    set((state) => {
      const next = new Map(state.conversationsBySession);
      const prev = next.get(sessionId) ?? emptyConversation();
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
      next.set(sessionId, { ...prev, entries });
      return { conversationsBySession: next };
    }),
}));

export function sessionsByRecency(map: Map<string, Session>): Session[] {
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function runsForSession(
  state: AppState,
  sessionId: string,
): Run[] {
  const inner = state.runsBySession.get(sessionId);
  if (!inner) return [];
  return [...inner.values()].sort((a, b) => a.createdAt - b.createdAt);
}
