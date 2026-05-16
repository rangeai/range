import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import * as api from "../lib/api";
import { runsForSession, useAppStore } from "../lib/store";
import { applyServerMessage, useWsSend } from "../lib/ws";
import { Markdown } from "./Markdown";
import type {
  AgentItem,
  ArtifactInfo,
  ProfileCommand,
  ProfileLoadResult,
  Run,
  RunLogEntry,
  RunState,
  Scenario,
  Session,
  VerificationGate,
  VerificationResult,
  VerificationStatus,
} from "@shared/protocol";
import type {
  ConversationEntry,
  ConversationState,
  PendingApproval,
} from "../lib/store";

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions.get(sessionId));
  const profile = useAppStore((s) => s.profilesBySession.get(sessionId));
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setProfile = useAppStore((s) => s.setProfile);

  useEffect(() => {
    if (!session) {
      api
        .getSession(sessionId)
        .then((res) => upsertSession(res.session))
        .catch((err) => console.error("getSession failed", err));
    }
    api
      .getProfile(sessionId)
      .then((res) => setProfile(sessionId, res.result))
      .catch((err) => console.error("getProfile failed", err));

    // Rehydrate the conversation from the server's persisted event log.
    // Only do this if the in-memory conversation is empty (avoids
    // double-applying on quick re-mounts).
    const conv = useAppStore.getState().conversationsBySession.get(sessionId);
    if (!conv || conv.entries.length === 0) {
      api
        .getAgentHistory(sessionId)
        .then(({ events, alive, threadId }) => {
          for (const ev of events) applyServerMessage(ev);
          // The event log might end on agent_stopped even though the
          // server has since spawned a new live thread (and vice versa).
          // Trust the server's current state as the source of truth.
          if (alive) {
            useAppStore.getState().patchConversation(sessionId, {
              status: "running",
              threadId,
              error: null,
            });
          }
        })
        .then(() =>
          // Backfill run/sweep cards into the conversation from the
          // persisted runs list. Runs aren't in events.jsonl — they
          // live in SQLite — so we fetch them separately and push
          // a conversation entry per run (the store dedupes sweeps).
          api.listRuns(sessionId).then((res) => {
            const store = useAppStore.getState();
            store.upsertManyRuns(res.runs);
            const sorted = [...res.runs].sort(
              (a, b) => a.createdAt - b.createdAt,
            );
            for (const run of sorted) {
              store.appendRunToConversation(sessionId, run);
            }
          }),
        )
        .catch((err) => console.error("rehydrate failed", err));
    }

    // Codex starts implicitly when a session is opened. The server's
    // startAgent is idempotent: if a thread is already running for this
    // session it just returns the existing thread id.
    api.startAgent(sessionId).catch((err) => {
      console.error("auto-start codex failed", err);
    });
  }, [sessionId, session, upsertSession, setProfile]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-3 text-[13px]">
        loading session {sessionId}…
      </div>
    );
  }

  return <SessionLayout session={session} profile={profile} />;
}

function SessionLayout({
  session,
  profile,
}: {
  session: Session;
  profile: ProfileLoadResult | undefined;
}) {
  const [railOpen, setRailOpen] = useState(true);
  return (
    <div className="h-full flex overflow-hidden">
      {/* Main column: header + worktree + conversation (scrolls) + composer (pinned) */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <ConversationScroller>
          <div className="max-w-3xl mx-auto px-6 pt-6 pb-2 w-full">
            <SessionHeader session={session} profile={profile} />
            <WorktreeBlock session={session} />
            <ConversationBlock session={session} />
          </div>
        </ConversationScroller>
        <div className="border-t border-[var(--br-1)] bg-[var(--bg-1)] flex-shrink-0">
          <div className="max-w-3xl mx-auto px-6 py-3 w-full">
            <StickyComposer session={session} />
          </div>
        </div>
      </div>
      {/* Right rail: collapsible. Independent scroll when open. */}
      <aside
        className={`flex-shrink-0 border-l border-[var(--br-1)] bg-[var(--bg-1)] flex flex-col transition-[width] duration-150 ${railOpen ? "w-[460px]" : "w-[34px]"}`}
      >
        <button
          onClick={() => setRailOpen((o) => !o)}
          title={railOpen ? "collapse panel" : "expand panel"}
          className="h-9 flex items-center justify-center border-b border-[var(--br-1)] text-fg-3 hover:text-fg-1 hover:bg-[var(--bg-2)] transition flex-shrink-0"
        >
          <svg
            className={`w-3 h-3 transition-transform ${railOpen ? "" : "rotate-180"}`}
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {!railOpen && (
            <span
              className="ml-1.5 text-[10px] tracking-[0.18em] uppercase"
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                marginTop: 6,
              }}
            >
              runs · pr
            </span>
          )}
        </button>
        {railOpen && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
            <RunsBlock session={session} profile={profile} />
            <PrBlock session={session} />
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * Scrolling container that pins the latest content at the bottom of the
 * viewport (Claude Code / terminal style). If the user has scrolled up
 * to read history, we leave their scroll position alone — auto-stick
 * only resumes when they're already at the bottom.
 */
function ConversationScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = distFromBottom < 40;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new MutationObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    // Initial snap to bottom.
    el.scrollTop = el.scrollHeight;
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto min-h-0">
      {children}
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

function SessionHeader({
  session,
  profile,
}: {
  session: Session;
  profile: ProfileLoadResult | undefined;
}) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] tracking-[0.18em] uppercase text-fg-3">
          {labelForSessionKind(session.kind)}
        </span>
        <span className="text-fg-3 text-[10px]">·</span>
        <span className="font-mono text-[10.5px] text-fg-3">
          {session.id}
        </span>
        <ProfileBadge profile={profile} />
      </div>
      <h1 className="font-display tracking-tightest text-[28px] font-light leading-tight text-fg">
        {session.title}
      </h1>
      {session.prompt && session.prompt !== session.title && (
        <p className="mt-2 text-[13px] text-fg-2 leading-relaxed">
          {session.prompt}
        </p>
      )}
    </header>
  );
}

function ProfileBadge({
  profile,
}: {
  profile: ProfileLoadResult | undefined;
}) {
  if (!profile) return null;
  if (!profile.found) return null;
  if (profile.error) {
    return (
      <>
        <span className="text-fg-3 text-[10px]">·</span>
        <span
          className="text-[10.5px] text-[var(--err)]"
          title={profile.error}
        >
          profile parse error
        </span>
      </>
    );
  }
  const count = profile.profile?.commands.length ?? 0;
  return (
    <>
      <span className="text-fg-3 text-[10px]">·</span>
      <span className="text-[10.5px] text-fg-2 flex items-center gap-1">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--ok)" }}
        />
        range.yaml · <span className="font-mono">{count}</span>
      </span>
    </>
  );
}

// ─── Worktree block ────────────────────────────────────────────────────────

function WorktreeBlock({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  if (!session.worktreePath) return null;

  const projectName = projectNameFromPath(session.repoPath);

  return (
    <div className="border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] mb-6 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--bg-2)] transition"
      >
        <svg
          className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0"
          viewBox="0 0 14 14"
          fill="none"
        >
          <path
            d="M1.5 3.5h3.5l1 1H12a.5.5 0 01.5.5V11a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[13.5px] text-fg font-medium truncate">
          {projectName}
        </span>
        {session.repoPath && (
          <span
            className="text-[11px] text-fg-3 font-mono truncate min-w-0 hidden sm:inline"
            title={session.repoPath}
          >
            {session.repoPath}
          </span>
        )}
        <div className="flex-1"></div>
        <Pill>{session.sandbox}</Pill>
        {session.branch && (
          <Pill mono title={session.branch}>
            {compactBranch(session.branch)}
          </Pill>
        )}
        <svg
          className={`w-2.5 h-2.5 text-fg-3 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M4 2l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[var(--br-1)] px-3 py-3 grid grid-cols-2 gap-3 bg-[var(--bg)]">
          <Fact
            label="project path"
            value={session.repoPath ?? "—"}
            mono={!!session.repoPath}
            breakAll
          />
          <Fact
            label="branch"
            value={session.branch ?? "—"}
            mono={!!session.branch}
            breakAll
          />
          <Fact
            label="worktree (range internal)"
            value={session.worktreePath}
            mono
            breakAll
          />
          <Fact
            label="base sha"
            value={session.baseSha?.slice(0, 12) ?? "—"}
            mono={!!session.baseSha}
          />
        </div>
      )}
    </div>
  );
}

function Pill({
  children,
  mono,
  title,
}: {
  children: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`flex-shrink-0 text-[10.5px] px-1.5 py-0.5 rounded border border-[var(--br-1)] bg-[var(--bg)] text-fg-2 ${
        mono ? "font-mono" : "uppercase tracking-[0.12em]"
      }`}
    >
      {children}
    </span>
  );
}

function projectNameFromPath(p: string | null): string {
  if (!p) return "no project";
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function compactBranch(branch: string): string {
  // Range branches look like "range/ssn_xxx/main"; collapse the middle
  // session id so the chip is glanceable.
  const m = branch.match(/^range\/ssn_[^/]+\/(.+)$/);
  if (m) return `range/…/${m[1]}`;
  if (branch.length > 28) return branch.slice(0, 25) + "…";
  return branch;
}

// ─── Conversation block ────────────────────────────────────────────────────

const EMPTY_CONV: ConversationState = {
  status: "stopped",
  threadId: null,
  turnInFlight: false,
  error: null,
  entries: [],
};

function ConversationBlock({ session }: { session: Session }) {
  const conv = useAppStore(
    (s) => s.conversationsBySession.get(session.id) ?? EMPTY_CONV,
  );

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
            conversation
          </span>
          <ConversationStatusChip conv={conv} />
        </div>
        <AgentControls session={session} conv={conv} />
      </div>
      <ContextCard session={session} />
      <ConversationTimeline conv={conv} sessionId={session.id} />
    </section>
  );
}

function ContextCard({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Only show this card when there's a worktree (else there's no
  // meaningful context to show).
  if (!session.worktreePath) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && text === null && !loading) {
      setLoading(true);
      try {
        const res = await api.getAgentContext(session.id);
        setText(res.baseInstructions);
      } catch (e) {
        setText(`(failed to load: ${String(e instanceof Error ? e.message : e)})`);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="mb-3 border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] overflow-hidden">
      <button
        onClick={toggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--bg-2)] transition"
      >
        <svg
          className={`w-2.5 h-2.5 text-fg-3 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M4 2l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[10.5px] tracking-[0.16em] uppercase text-fg-3 font-medium">
          context Codex sees
        </span>
        <div className="flex-1"></div>
        <span className="text-[10.5px] text-fg-3 italic">
          {open ? "click to hide" : "click to inspect"}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--br-1)] bg-[var(--bg)] p-3 max-h-[240px] overflow-y-auto">
          {loading ? (
            <div className="text-[11.5px] text-fg-3 italic">loading…</div>
          ) : (
            <pre className="font-mono text-[11.5px] text-fg-1 whitespace-pre-wrap break-words">
              {text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ConversationStatusChip({ conv }: { conv: ConversationState }) {
  let label = "stopped";
  let color = "var(--fg-3)";
  let dot = false;
  if (conv.status === "starting") {
    label = "starting…";
    color = "var(--warn)";
    dot = true;
  } else if (conv.status === "running" && conv.turnInFlight) {
    label = "codex working";
    color = "var(--accent)";
    dot = true;
  } else if (conv.status === "running") {
    label = "ready";
    color = "var(--ok)";
    dot = true;
  } else if (conv.status === "error") {
    label = "error";
    color = "var(--err)";
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10.5px] font-medium"
      style={{ color }}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            conv.turnInFlight || conv.status === "starting" ? "pulse-live" : ""
          }`}
          style={{ background: color }}
        />
      )}
      {label}
    </span>
  );
}

function AgentControls({
  session,
  conv,
}: {
  session: Session;
  conv: ConversationState;
}) {
  const [busy, setBusy] = useState(false);

  const running = conv.status === "running" || conv.status === "starting";
  if (!running) return null;

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.stopAgent(session.id);
    } catch (e) {
      console.error("stop agent failed", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={stop}
      disabled={busy}
      className="text-[11px] text-fg-1 border border-[var(--br-1)] hover:border-[var(--br-2)] hover:bg-[var(--bg-2)] px-2.5 py-1 rounded transition flex items-center gap-1.5"
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="currentColor">
        <rect x="3" y="3" width="6" height="6" rx="1" />
      </svg>
      {busy ? "stopping…" : "stop"}
    </button>
  );
}

function ConversationTimeline({
  conv,
  sessionId,
}: {
  conv: ConversationState;
  sessionId: string;
}) {
  if (conv.entries.length === 0 && conv.status === "stopped") {
    return (
      <div className="border border-dashed border-[var(--br-1)] rounded-lg p-6 mb-3 bg-[var(--bg-1)]/40">
        <div className="text-[12.5px] text-fg-2 leading-relaxed">
          Codex is warming up… the thread will appear here once it's ready.
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] p-4 space-y-4">
      {conv.entries.map((entry, i) => (
        <ConversationEntryView key={i} entry={entry} sessionId={sessionId} />
      ))}
      {conv.status === "error" && conv.error && (
        <div className="text-[11.5px] text-[var(--err)] border border-[var(--err)]/40 bg-[var(--err)]/10 rounded p-2 break-words">
          {conv.error}
        </div>
      )}
    </div>
  );
}

function ConversationEntryView({
  entry,
  sessionId,
}: {
  entry: ConversationEntry;
  sessionId: string;
}) {
  if (entry.kind === "user") {
    return (
      <div className="flex gap-3">
        <div className="w-7 h-7 flex-shrink-0 rounded-full bg-[var(--bg-3)] border border-[var(--br-2)] text-[10.5px] flex items-center justify-center font-medium text-fg-1">
          you
        </div>
        <div className="flex-1 min-w-0 text-[13.5px] text-fg-1 leading-relaxed whitespace-pre-wrap break-words">
          {entry.text}
        </div>
      </div>
    );
  }
  if (entry.kind === "system") {
    return (
      <div className="text-[10.5px] text-fg-3 italic">{entry.text}</div>
    );
  }
  if (entry.kind === "approval") {
    return (
      <ApprovalCard approval={entry.approval} sessionId={sessionId} />
    );
  }
  if (entry.kind === "run") {
    return <InlineRunEntry runId={entry.runId} sessionId={sessionId} />;
  }
  if (entry.kind === "sweep") {
    return <InlineSweepEntry sweepId={entry.sweepId} sessionId={sessionId} />;
  }
  return <AgentItemView item={entry.item} />;
}

/** Looks up the live Run by id and renders a RunRow card inline. */
function InlineRunEntry({
  runId,
  sessionId,
}: {
  runId: string;
  sessionId: string;
}) {
  const run = useAppStore((s) =>
    s.runsBySession.get(sessionId)?.get(runId),
  );
  if (!run) {
    return (
      <div className="text-[10.5px] text-fg-3 italic">
        run {runId} (not loaded)
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <AgentBadge label="▶" tone="tool" />
      <div className="flex-1 min-w-0">
        <RunRow run={run} />
      </div>
    </div>
  );
}

/** Looks up all Runs that share a sweepId and renders them as one
 *  SweepGroup card inline. */
function InlineSweepEntry({
  sweepId,
  sessionId,
}: {
  sweepId: string;
  sessionId: string;
}) {
  const runs = useAppStore(
    useShallow((s) => {
      const inner = s.runsBySession.get(sessionId);
      if (!inner) return [] as Run[];
      return [...inner.values()]
        .filter((r) => r.sweepId === sweepId)
        .sort((a, b) => a.createdAt - b.createdAt);
    }),
  );
  if (runs.length === 0) {
    return (
      <div className="text-[10.5px] text-fg-3 italic">
        sweep {sweepId} (loading runs…)
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <AgentBadge label="⋮▶" tone="tool" />
      <div className="flex-1 min-w-0">
        <SweepGroup runs={runs} />
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  sessionId,
}: {
  approval: PendingApproval;
  sessionId: string;
}) {
  const wsSend = useWsSend();
  const resolveApproval = useAppStore((s) => s.resolveApproval);

  const decide = (decision: "accept" | "decline") => {
    if (approval.decision) return;
    resolveApproval(sessionId, approval.requestId, decision);
    wsSend({
      type: "agent_approval_response",
      sessionId,
      requestId: approval.requestId,
      decision,
    });
  };

  const headline = approvalHeadline(approval);
  const body = approvalBody(approval);
  const resolved = approval.decision !== null;

  return (
    <div className="flex gap-3">
      <AgentBadge label="!" tone="warn" />
      <div
        className={`flex-1 min-w-0 border rounded-lg overflow-hidden ${
          resolved
            ? "border-[var(--br-1)] bg-[var(--bg-1)]"
            : "border-[var(--warn)]/60 bg-[var(--warn)]/8"
        }`}
      >
        <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--br-1)]">
          <span
            className="text-[10px] tracking-[0.16em] uppercase font-medium"
            style={{
              color: resolved ? "var(--fg-3)" : "var(--warn)",
            }}
          >
            approval · {approval.kind}
          </span>
          <span className="text-fg-3 text-[10px]">·</span>
          <span className="text-[11.5px] text-fg-1 truncate flex-1">
            {headline}
          </span>
        </div>
        {body && (
          <pre className="font-mono text-[11.5px] text-fg-2 px-3 py-2 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words">
            {body}
          </pre>
        )}
        <div className="px-3 py-2 flex items-center gap-1.5 border-t border-[var(--br-1)]">
          {resolved ? (
            <span
              className="text-[11px] font-medium"
              style={{
                color:
                  approval.decision === "accept"
                    ? "var(--ok)"
                    : "var(--err)",
              }}
            >
              {approval.decision === "accept" ? "accepted" : "declined"}
            </span>
          ) : (
            <>
              <button
                onClick={() => decide("accept")}
                className="text-[11px] text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] px-2.5 py-1 rounded transition font-medium"
              >
                accept
              </button>
              <button
                onClick={() => decide("decline")}
                className="text-[11px] text-fg-1 border border-[var(--br-2)] hover:border-[var(--br-3)] hover:bg-[var(--bg-2)] px-2.5 py-1 rounded transition"
              >
                decline
              </button>
              <span className="text-[10.5px] text-fg-3 italic ml-1">
                Codex is waiting
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function approvalHeadline(approval: PendingApproval): string {
  const { kind, payload } = approval;
  if (payload.path) {
    const change = payload.changeKind ?? "edit";
    return `${change} ${payload.path}`;
  }
  if (payload.command) {
    return Array.isArray(payload.command)
      ? payload.command.join(" ")
      : payload.command;
  }
  if (payload.description) return payload.description;
  return kind;
}

function approvalBody(approval: PendingApproval): string | null {
  const parts: string[] = [];
  if (approval.payload.cwd) parts.push(`cwd: ${approval.payload.cwd}`);
  if (
    approval.payload.description &&
    approval.payload.description !== approvalHeadline(approval)
  ) {
    parts.push(approval.payload.description);
  }
  return parts.length ? parts.join("\n") : null;
}

function AgentItemView({ item }: { item: AgentItem }) {
  const inProgress = item.state === "started";
  switch (item.kind) {
    case "message":
      return (
        <div className="flex gap-3">
          <AgentBadge label="cdx" />
          <div className="flex-1 min-w-0 text-[13.5px] text-fg-1 break-words">
            {item.text ? (
              <Markdown>{item.text}</Markdown>
            ) : inProgress ? (
              "…"
            ) : (
              ""
            )}
            {inProgress && item.text && (
              <span className="inline-block w-[2px] h-[14px] bg-[var(--accent)] ml-0.5 align-middle pulse-live" />
            )}
          </div>
        </div>
      );
    case "reasoning":
      return (
        <div className="flex gap-3">
          <AgentBadge label="·" />
          <div className="flex-1 min-w-0 text-[12px] text-fg-3 italic break-words">
            {item.text ? (
              <Markdown>{item.text}</Markdown>
            ) : inProgress ? (
              "thinking…"
            ) : (
              ""
            )}
          </div>
        </div>
      );
    case "command":
      return <CommandItemView item={item} inProgress={inProgress} />;
    case "file_edit":
      return (
        <div className="flex gap-3">
          <AgentBadge label="✎" tone="tool" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-fg-1 font-mono break-words">
              {item.changeKind} {item.path}
            </div>
            {item.summary && (
              <div className="text-[11px] text-fg-3 mt-0.5">
                {item.summary}
              </div>
            )}
          </div>
        </div>
      );
    case "mcp_tool":
      return (
        <div className="flex gap-3">
          <AgentBadge label="t" tone="tool" />
          <div className="flex-1 min-w-0 text-[12px] text-fg-1 font-mono">
            mcp · {item.server ?? "?"}:{item.tool ?? "?"}
          </div>
        </div>
      );
    case "web_search":
      return (
        <div className="flex gap-3">
          <AgentBadge label="?" tone="tool" />
          <div className="flex-1 min-w-0 text-[12px] text-fg-1">
            web search · {item.query ?? "(no query)"}
          </div>
        </div>
      );
    default:
      return <UnknownItemView item={item} />;
  }
}

function UnknownItemView({
  item,
}: {
  item: Extract<AgentItem, { kind: "unknown" }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-3 items-center">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[10.5px] text-fg-3 italic hover:text-fg-2 transition"
        title="agent emitted an event Range doesn't have a renderer for"
      >
        · {open ? "hide" : "show"} raw agent item
      </button>
      {open && (
        <pre className="ml-2 font-mono text-[10.5px] text-fg-3 bg-[var(--bg)] border border-[var(--br-1)] rounded p-2 max-h-[160px] overflow-auto break-words flex-1 min-w-0">
          {JSON.stringify(item.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CommandItemView({
  item,
  inProgress,
}: {
  item: Extract<AgentItem, { kind: "command" }>;
  inProgress: boolean;
}) {
  // Always start collapsed. While the command is still running we
  // auto-expand so the user can watch live output; once it completes
  // we collapse back unless the user explicitly opened it.
  const [userOpen, setUserOpen] = useState(false);
  const expanded = userOpen || inProgress;

  const cmd =
    typeof item.command === "string"
      ? item.command
      : item.command.join(" ");
  const shortCmd = prettyCommand(cmd);
  const exitColor =
    item.exitCode === 0
      ? "var(--ok)"
      : item.exitCode == null
        ? "var(--fg-3)"
        : "var(--err)";

  return (
    <div className="flex gap-3">
      <AgentBadge label="$" tone="tool" />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setUserOpen((o) => !o)}
          className="w-full flex items-center gap-2 text-left group"
        >
          <svg
            className={`w-2.5 h-2.5 text-fg-3 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-mono text-[12px] text-fg-1 truncate min-w-0 group-hover:text-fg">
            {shortCmd}
          </span>
          {item.state === "completed" ? (
            <span
              className="font-mono text-[10.5px] flex-shrink-0"
              style={{ color: exitColor }}
            >
              exit {item.exitCode ?? "?"}
            </span>
          ) : (
            <span className="font-mono text-[10.5px] text-[var(--accent)] flex-shrink-0 pulse-live">
              running…
            </span>
          )}
          {item.durationMs != null && (
            <span className="font-mono text-[10.5px] text-fg-3 flex-shrink-0">
              {item.durationMs}ms
            </span>
          )}
        </button>
        {expanded && (
          <div className="mt-1.5">
            {shortCmd !== cmd && (
              <pre className="font-mono text-[11.5px] text-fg-2 bg-[var(--bg)] border border-[var(--br-1)] rounded p-2 mb-2 whitespace-pre-wrap break-words">
                {cmd}
              </pre>
            )}
            {item.output && (
              <pre className="font-mono text-[11px] text-fg-2 bg-[var(--bg)] border border-[var(--br-1)] rounded p-2 max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words">
                {item.output}
              </pre>
            )}
            {item.state === "completed" && !item.output && (
              <div className="text-[10.5px] text-fg-3 italic">
                no output
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function prettyCommand(cmd: string): string {
  // Codex usually wraps shell commands as: /bin/zsh -lc "actual command"
  // — peel that off for the summary line. Falls back to the raw cmd.
  const m = cmd.match(/^\/bin\/(?:ba|z)sh\s+-l?c\s+(['"])(.*)\1\s*$/s);
  if (m) return m[2]!;
  return cmd;
}

type BadgeTone = "talk" | "tool" | "warn";

function AgentBadge({
  label,
  tone = "talk",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const style =
    tone === "tool"
      ? {
          background: "color-mix(in oklch, var(--accent) 14%, var(--bg-2))",
          borderColor: "color-mix(in oklch, var(--accent) 30%, var(--br-2))",
          color: "var(--accent)",
        }
      : tone === "warn"
        ? {
            background: "color-mix(in oklch, var(--warn) 14%, var(--bg-2))",
            borderColor: "color-mix(in oklch, var(--warn) 30%, var(--br-2))",
            color: "var(--warn)",
          }
        : undefined;
  return (
    <div
      className="w-7 h-7 flex-shrink-0 rounded border text-[10.5px] flex items-center justify-center font-mono"
      style={
        style ?? {
          background: "var(--bg-2)",
          borderColor: "var(--br-2)",
          color: "var(--fg-1)",
        }
      }
    >
      {label}
    </div>
  );
}

function StickyComposer({ session }: { session: Session }) {
  const conv = useAppStore(
    (s) => s.conversationsBySession.get(session.id) ?? EMPTY_CONV,
  );
  return <MessageComposer session={session} conv={conv} />;
}

function MessageComposer({
  session,
  conv,
}: {
  session: Session;
  conv: ConversationState;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashErr, setSlashErr] = useState<string | null>(null);
  const pushUserMessage = useAppStore((s) => s.pushUserMessage);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const patch = useAppStore((s) => s.patchConversation);
  const profile = useAppStore((s) =>
    s.profilesBySession.get(session.id),
  );

  // Slash-command items (scenarios + commands from range.yaml).
  type SlashItem =
    | { kind: "scenario"; name: string; description?: string; sweepCount: number }
    | { kind: "command"; name: string; description?: string; args: string[] };
  const allItems: SlashItem[] = (() => {
    const p = profile?.profile;
    if (!p) return [];
    const items: SlashItem[] = [];
    for (const s of p.scenarios) {
      const sweepCount = s.sweep
        ? Object.values(s.sweep.params).reduce((a, v) => a * v.length, 1)
        : 1;
      items.push({
        kind: "scenario",
        name: s.name,
        description: s.description,
        sweepCount,
      });
    }
    for (const c of p.commands) {
      items.push({
        kind: "command",
        name: c.name,
        description: c.description,
        args: c.args,
      });
    }
    return items;
  })();

  const slashOpen = text.startsWith("/");
  const slashQuery = slashOpen ? text.slice(1).toLowerCase() : "";
  const matched = slashOpen
    ? allItems.filter((it) => it.name.toLowerCase().includes(slashQuery))
    : [];
  const slashSelection = matched[Math.min(slashIdx, Math.max(0, matched.length - 1))];

  const canSend =
    conv.status === "running" &&
    !conv.turnInFlight &&
    text.trim().length > 0 &&
    !busy &&
    !slashOpen;

  const submit = async () => {
    if (!canSend) return;
    const prompt = text.trim();
    setBusy(true);
    pushUserMessage(session.id, prompt);
    setText("");
    try {
      await api.sendAgentMessage(session.id, prompt);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      patch(session.id, { error: msg, turnInFlight: false });
    } finally {
      setBusy(false);
    }
  };

  const runSlash = async (item: SlashItem) => {
    if (busy) return;
    setBusy(true);
    setSlashErr(null);
    try {
      if (item.kind === "scenario") {
        await api.runScenario(session.id, item.name);
      } else {
        await api.createRun(session.id, {
          command: item.args,
          kind: "shell",
        });
      }
      setText("");
    } catch (e) {
      setSlashErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(matched.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setText("");
        setSlashIdx(0);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (slashSelection) void runSlash(slashSelection);
        return;
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onPickRepo = async (path: string) => {
    setRepoPickerOpen(false);
    try {
      const res = await api.attachRepo(session.id, path);
      upsertSession(res.session);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      patch(session.id, { error: msg });
    }
  };

  const placeholder =
    conv.status === "stopped"
      ? "Codex is warming up… hang tight"
      : conv.status === "starting"
        ? "Codex is starting…"
        : conv.turnInFlight
          ? "Codex is working on the previous turn…"
          : "type a message, or `/` for scenarios + commands…";

  const noRepo = !session.worktreePath;

  return (
    <>
      {slashOpen && (
        <SlashPicker
          items={matched}
          selectedIdx={Math.min(slashIdx, Math.max(0, matched.length - 1))}
          onPick={(it) => runSlash(it)}
          query={slashQuery}
        />
      )}
      <div className="border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)]">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSlashIdx(0);
          }}
          onKeyDown={onKeyDown}
          disabled={
            (conv.status !== "running" || conv.turnInFlight) && !slashOpen
          }
          placeholder={placeholder}
          rows={2}
          className="w-full bg-transparent outline-none resize-none text-[13px] text-fg placeholder:text-fg-3 leading-relaxed disabled:opacity-60 px-3 py-2"
        />
        <div className="px-3 py-1.5 border-t border-[var(--br-1)] flex items-center gap-2 bg-[var(--bg)]">
          <span className="text-[10.5px] text-fg-3">
            {slashOpen
              ? "↑↓ to navigate · ⏎ to run · esc to cancel"
              : "⏎ to send · ⇧⏎ newline · / for scenarios"}
          </span>
          <div className="flex-1"></div>
          {noRepo && !slashOpen && (
            <button
              onClick={() => setRepoPickerOpen(true)}
              title="attach a repo to this session"
              className="text-[11px] text-fg-1 border border-[var(--br-2)] hover:border-[var(--br-3)] hover:bg-[var(--bg-2)] px-2.5 py-1 rounded transition flex items-center gap-1.5"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                <path
                  d="M1.5 3.5h3l1 1H10a.5.5 0 01.5.5V9a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              attach repo
            </button>
          )}
          {!slashOpen && (
            <button
              onClick={submit}
              disabled={!canSend}
              className="text-[11px] text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded transition font-medium"
            >
              send
            </button>
          )}
        </div>
        {slashErr && (
          <div className="px-3 py-2 text-[11px] text-[var(--err)] border-t border-[var(--br-1)] break-words">
            {slashErr}
          </div>
        )}
      </div>
      {repoPickerOpen && (
        <RepoPicker
          onPick={onPickRepo}
          onClose={() => setRepoPickerOpen(false)}
        />
      )}
    </>
  );
}

function SlashPicker({
  items,
  selectedIdx,
  onPick,
  query,
}: {
  items: Array<
    | { kind: "scenario"; name: string; description?: string; sweepCount: number }
    | { kind: "command"; name: string; description?: string; args: string[] }
  >;
  selectedIdx: number;
  onPick: (
    item:
      | { kind: "scenario"; name: string; description?: string; sweepCount: number }
      | { kind: "command"; name: string; description?: string; args: string[] }
  ) => void;
  query: string;
}) {
  if (items.length === 0) {
    return (
      <div className="border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)] p-3 mb-2 text-[11.5px] text-fg-3 italic">
        no scenarios or commands match{" "}
        <span className="font-mono text-fg-2">/{query}</span>
      </div>
    );
  }
  return (
    <div className="border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)] overflow-hidden mb-2 max-h-[280px] overflow-y-auto">
      {items.map((it, i) => {
        const isSel = i === selectedIdx;
        return (
          <button
            key={`${it.kind}-${it.name}`}
            onClick={() => onPick(it)}
            className={`w-full px-3 py-2 flex items-center gap-2 text-left transition ${
              isSel
                ? "bg-[var(--bg-2)] border-l-2 border-[var(--accent)]"
                : "border-l-2 border-transparent hover:bg-[var(--bg-2)]"
            }`}
          >
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em] flex-shrink-0"
              style={{
                color: it.kind === "scenario" ? "var(--accent)" : "var(--fg-3)",
              }}
            >
              {it.kind === "scenario" ? "▶" : "$"}
            </span>
            <span className="font-mono text-[12.5px] text-fg-1 flex-shrink-0">
              {it.name}
            </span>
            {it.kind === "scenario" && it.sweepCount > 1 && (
              <span className="font-mono text-[10px] text-[var(--accent)]">
                ×{it.sweepCount}
              </span>
            )}
            <span className="text-[11px] text-fg-3 truncate flex-1 min-w-0">
              {it.description ??
                (it.kind === "command" ? it.args.join(" ") : "")}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-fg-3 flex-shrink-0">
              {it.kind}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RepoPicker({
  onPick,
  onClose,
}: {
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    path: string;
    parent: string | null;
    entries: { name: string; path: string; isGitRepo: boolean }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (path?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.listFs(path);
      setData({
        path: res.path,
        parent: res.parent,
        entries: res.entries,
      });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)] shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[var(--br-1)] flex items-center gap-3">
          <span className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
            attach a repo
          </span>
          <div className="flex-1"></div>
          <button
            onClick={onClose}
            className="text-fg-3 hover:text-fg-1 text-[14px] leading-none px-1"
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[var(--br-1)] bg-[var(--bg)]">
          <div className="font-mono text-[11.5px] text-fg-2 break-all flex items-center gap-2">
            {data?.parent && (
              <button
                onClick={() => data && load(data.parent ?? undefined)}
                title={`up to ${data.parent}`}
                className="text-fg-3 hover:text-fg-1 px-1 transition"
              >
                ↑
              </button>
            )}
            <span>{data?.path ?? "…"}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-[12px] text-fg-3 italic">
              loading…
            </div>
          )}
          {err && (
            <div className="px-4 py-3 text-[12px] text-[var(--err)] break-words">
              {err}
            </div>
          )}
          {!loading && !err && data && data.entries.length === 0 && (
            <div className="px-4 py-6 text-[12px] text-fg-3 italic">
              no subdirectories here.
            </div>
          )}
          {!loading &&
            data?.entries.map((e) => (
              <button
                key={e.path}
                onDoubleClick={() => {
                  if (e.isGitRepo) onPick(e.path);
                  else load(e.path);
                }}
                onClick={() => load(e.path)}
                className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-[var(--bg-2)] transition"
                title={
                  e.isGitRepo
                    ? "double-click to attach · or open"
                    : "open"
                }
              >
                <svg
                  className={`w-3.5 h-3.5 flex-shrink-0 ${
                    e.isGitRepo ? "text-[var(--accent)]" : "text-fg-3"
                  }`}
                  viewBox="0 0 14 14"
                  fill="none"
                >
                  {e.isGitRepo ? (
                    <>
                      <circle
                        cx="7"
                        cy="7"
                        r="5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M5 6l1.5 1.5L9 5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </>
                  ) : (
                    <path
                      d="M1.5 3.5h3.5l1 1H12a.5.5 0 01.5.5V11a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
                <span className="text-[13px] text-fg-1 truncate flex-1">
                  {e.name}
                </span>
                {e.isGitRepo && (
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--accent)] font-medium">
                    git
                  </span>
                )}
              </button>
            ))}
        </div>

        <div className="px-4 py-3 border-t border-[var(--br-1)] bg-[var(--bg)] flex items-center gap-2">
          <span className="text-[10.5px] text-fg-3 italic flex-1">
            click to open · double-click a{" "}
            <span className="text-[var(--accent)] font-medium">git</span> entry
            to attach, or pick the current folder →
          </span>
          <button
            onClick={() => data && onPick(data.path)}
            disabled={!data}
            className="text-[11.5px] font-medium text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded transition"
          >
            attach this folder
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Runs block ────────────────────────────────────────────────────────────

function RunsBlock({
  session,
  profile,
}: {
  session: Session;
  profile: ProfileLoadResult | undefined;
}) {
  const runs = useAppStore(
    useShallow((s) => runsForSession(s, session.id)),
  );
  const upsertManyRuns = useAppStore((s) => s.upsertManyRuns);
  const setVerificationResults = useAppStore((s) => s.setVerificationResults);

  useEffect(() => {
    api
      .listRuns(session.id)
      .then((res) => upsertManyRuns(res.runs))
      .catch((err) => console.error("listRuns failed", err));
    api
      .getVerification(session.id)
      .then((res) => setVerificationResults(session.id, res.results))
      .catch((err) => console.error("getVerification failed", err));
  }, [session.id, upsertManyRuns, setVerificationResults]);

  const profileCommands = profile?.profile?.commands ?? [];
  const gates = profile?.profile?.gates ?? [];
  const scenarios = profile?.profile?.scenarios ?? [];

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
          runs
        </div>
        <span className="text-[10.5px] font-mono text-fg-3">{runs.length}</span>
      </div>

      {scenarios.length > 0 && (
        <ScenariosStrip session={session} scenarios={scenarios} />
      )}

      {gates.length > 0 && (
        <VerificationStrip sessionId={session.id} gates={gates} />
      )}

      {profileCommands.length > 0 && (
        <ProfileCommandStrip session={session} commands={profileCommands} />
      )}

      <RunLauncher session={session} />

      {runs.length > 0 && <RunsList runs={runs} />}
    </section>
  );
}

function ArtifactPanel({ run }: { run: Run }) {
  const artifacts = useAppStore((s) => s.artifactsByRun.get(run.id));
  const setRunArtifacts = useAppStore((s) => s.setRunArtifacts);

  useEffect(() => {
    if (artifacts) return;
    if (run.state !== "succeeded" && run.state !== "failed") return;
    api
      .listRunArtifacts(run.id)
      .then((res) => setRunArtifacts(run.id, res.artifacts))
      .catch((err) => console.error("listRunArtifacts failed", err));
  }, [run.id, run.state, artifacts, setRunArtifacts]);

  if (!artifacts || artifacts.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
          artifacts
        </div>
        <span className="text-[10.5px] font-mono text-fg-3">
          {artifacts.length}
        </span>
      </div>
      <div className="space-y-2">
        {artifacts.map((a) => (
          <ArtifactRow key={a.name} runId={run.id} artifact={a} />
        ))}
      </div>
    </div>
  );
}

function ArtifactRow({
  runId,
  artifact,
}: {
  runId: string;
  artifact: ArtifactInfo;
}) {
  const url = api.artifactUrl(runId, artifact.name);
  const sizeLabel = formatBytes(artifact.size);

  return (
    <div className="border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2">
        <ArtifactKindBadge kind={artifact.kind} />
        <span className="font-mono text-[12px] text-fg-1 truncate flex-1">
          {artifact.name}
        </span>
        <span className="text-[10.5px] font-mono text-fg-3 flex-shrink-0">
          {sizeLabel}
        </span>
        <a
          href={url}
          download={artifact.name}
          className="text-[10.5px] text-[var(--accent)] hover:underline px-1"
        >
          download
        </a>
      </div>
      <ArtifactPreview kind={artifact.kind} url={url} name={artifact.name} />
    </div>
  );
}

function ArtifactPreview({
  kind,
  url,
  name,
}: {
  kind: ArtifactInfo["kind"];
  url: string;
  name: string;
}) {
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);

  useEffect(() => {
    if (kind === "json" && jsonText === null) {
      fetch(url)
        .then((r) => r.text())
        .then((t) => {
          try {
            setJsonText(JSON.stringify(JSON.parse(t), null, 2));
          } catch {
            setJsonText(t.slice(0, 4000));
          }
        })
        .catch(() => setJsonText("(failed to load)"));
    }
    if (kind === "csv" && csvText === null) {
      fetch(url)
        .then((r) => r.text())
        .then((t) => setCsvText(t.split("\n").slice(0, 20).join("\n")))
        .catch(() => setCsvText("(failed to load)"));
    }
  }, [kind, url, jsonText, csvText]);

  if (kind === "image") {
    return (
      <div className="border-t border-[var(--br-1)] bg-[var(--bg)] p-2 flex justify-center">
        <img
          src={url}
          alt={name}
          className="max-h-[320px] object-contain rounded"
        />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="border-t border-[var(--br-1)] bg-[var(--bg)] p-2 flex justify-center">
        <video
          src={url}
          controls
          className="max-h-[320px] rounded"
        />
      </div>
    );
  }
  if (kind === "json") {
    return (
      <pre className="border-t border-[var(--br-1)] bg-[var(--bg)] p-2 font-mono text-[11px] text-fg-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words">
        {jsonText ?? "loading…"}
      </pre>
    );
  }
  if (kind === "csv") {
    return (
      <pre className="border-t border-[var(--br-1)] bg-[var(--bg)] p-2 font-mono text-[11px] text-fg-2 max-h-[200px] overflow-auto whitespace-pre">
        {csvText ?? "loading…"}
      </pre>
    );
  }
  if (kind === "usd" || kind === "mesh") {
    return (
      <div className="border-t border-[var(--br-1)] bg-[var(--bg)] px-3 py-2 text-[11px] text-fg-3 italic">
        binary {kind === "usd" ? "USD" : "mesh"} — preview requires an
        external viewer. Use{" "}
        <span className="font-mono text-fg-2">download</span> to inspect.
      </div>
    );
  }
  return null;
}

function ArtifactKindBadge({ kind }: { kind: ArtifactInfo["kind"] }) {
  const map: Record<ArtifactInfo["kind"], { label: string; color: string }> = {
    usd: { label: "usd", color: "var(--accent)" },
    image: { label: "img", color: "var(--ok)" },
    video: { label: "vid", color: "var(--ok)" },
    csv: { label: "csv", color: "var(--warn)" },
    json: { label: "{}", color: "var(--warn)" },
    npy: { label: "npy", color: "var(--warn)" },
    mesh: { label: "msh", color: "var(--accent)" },
    other: { label: "···", color: "var(--fg-3)" },
  };
  const m = map[kind];
  return (
    <span
      className="font-mono text-[9.5px] px-1.5 py-0.5 rounded border tracking-[0.06em] uppercase"
      style={{
        color: m.color,
        borderColor: `color-mix(in oklch, ${m.color} 35%, var(--br-1))`,
        background: `color-mix(in oklch, ${m.color} 10%, var(--bg))`,
      }}
    >
      {m.label}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function VerificationStrip({
  sessionId,
  gates,
}: {
  sessionId: string;
  gates: VerificationGate[];
}) {
  const results = useAppStore((s) =>
    s.verificationBySession.get(sessionId),
  );

  return (
    <div className="mb-3">
      <div className="text-[9.5px] tracking-[0.16em] uppercase text-fg-3 mb-2">
        verification gates
      </div>
      <div className="flex flex-wrap gap-1.5">
        {gates.map((g) => {
          const r = results?.get(g.name) ?? null;
          return <GateChip key={g.name} gate={g} result={r} />;
        })}
      </div>
    </div>
  );
}

function GateChip({
  gate,
  result,
}: {
  gate: VerificationGate;
  result: VerificationResult | null;
}) {
  const color = verificationColor(result?.status);
  const label = result?.status ?? "pending";
  const tip = result
    ? `${gate.command} · ${result.status} · ${result.reason}`
    : gate.description || `runs after \`${gate.command}\``;
  return (
    <div
      title={tip}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border rounded text-[11.5px] bg-[var(--bg-1)]"
      style={{ borderColor: color ?? "var(--br-1)" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color ?? "var(--br-3)" }}
      />
      <span className="font-mono text-fg-1">{gate.name}</span>
      <span
        className="text-[10.5px] font-mono"
        style={{ color: color ?? "var(--fg-3)" }}
      >
        {label}
      </span>
    </div>
  );
}

function verificationColor(
  status: VerificationStatus | undefined,
): string | undefined {
  switch (status) {
    case "pass":
      return "var(--ok)";
    case "warn":
      return "var(--warn)";
    case "fail":
    case "error":
      return "var(--err)";
    default:
      return undefined;
  }
}

function ScenariosStrip({
  session,
  scenarios,
}: {
  session: Session;
  scenarios: Scenario[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const launch = async (name: string) => {
    if (!session.worktreePath) return;
    setBusy(name);
    setErr(null);
    try {
      await api.runScenario(session.id, name);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-3">
      <div className="text-[9.5px] tracking-[0.16em] uppercase text-fg-3 mb-2">
        scenarios
      </div>
      <div className="flex flex-wrap gap-1.5">
        {scenarios.map((s) => {
          const sweepCount = s.sweep
            ? Object.values(s.sweep.params).reduce(
                (a, v) => a * v.length,
                1,
              )
            : 1;
          const isBusy = busy === s.name;
          return (
            <button
              key={s.name}
              onClick={() => launch(s.name)}
              disabled={!session.worktreePath || busy !== null}
              title={s.description ?? s.name}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border bg-[var(--bg-1)] hover:bg-[var(--bg-2)] disabled:opacity-50 disabled:cursor-not-allowed rounded text-[11.5px] text-fg-1 transition"
              style={{
                borderColor: isBusy
                  ? "var(--accent)"
                  : "color-mix(in oklch, var(--accent) 25%, var(--br-1))",
              }}
            >
              <svg
                className="w-2.5 h-2.5 text-[var(--accent)]"
                viewBox="0 0 12 12"
                fill="none"
              >
                <circle
                  cx="6"
                  cy="6"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M5 4l3 2-3 2z"
                  fill="currentColor"
                />
              </svg>
              <span className="font-mono">{s.name}</span>
              {sweepCount > 1 && (
                <span className="text-[10px] text-[var(--accent)] font-mono">
                  ×{sweepCount}
                </span>
              )}
              {isBusy && (
                <span className="text-[10px] text-fg-3 italic">launching…</span>
              )}
            </button>
          );
        })}
      </div>
      {err && (
        <div className="mt-1.5 text-[10.5px] text-[var(--err)] break-words">
          {err}
        </div>
      )}
    </div>
  );
}

function ProfileCommandStrip({
  session,
  commands,
}: {
  session: Session;
  commands: ProfileCommand[];
}) {
  const [busyName, setBusyName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const launch = async (cmd: ProfileCommand) => {
    if (!session.worktreePath) return;
    setBusyName(cmd.name);
    setErr(null);
    try {
      await api.createRun(session.id, {
        command: cmd.args,
        kind: "shell",
      });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusyName(null);
    }
  };

  const disabled = !session.worktreePath;

  return (
    <div className="mb-3">
      <div className="text-[9.5px] tracking-[0.16em] uppercase text-fg-3 mb-2">
        from range.yaml
      </div>
      <div className="flex flex-wrap gap-1.5">
        {commands.map((c) => (
          <button
            key={c.name}
            onClick={() => launch(c)}
            disabled={disabled || busyName !== null}
            title={c.description || c.args.join(" ")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[var(--br-1)] hover:border-[var(--br-2)] hover:bg-[var(--bg-2)] disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--bg-1)] rounded text-[11.5px] text-fg-1 font-mono transition"
          >
            <svg
              className="w-2.5 h-2.5 text-[var(--accent)]"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d="M3 2v8l7-4-7-4z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
            </svg>
            {busyName === c.name ? `${c.name}…` : c.name}
          </button>
        ))}
      </div>
      {err && (
        <div className="mt-1.5 text-[10.5px] text-[var(--err)] break-words">
          {err}
        </div>
      )}
    </div>
  );
}

function RunLauncher({ session }: { session: Session }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canRun =
    !!session.worktreePath && command.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canRun) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createRun(session.id, {
        command: command.trim(),
        kind: "shell",
      });
      setCommand("");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-[var(--br-1)] rounded-lg overflow-hidden bg-[var(--bg-1)] mb-3">
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-[var(--br-1)]">
        <span className="font-mono text-[12px] text-fg-3 select-none">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          disabled={!session.worktreePath || busy}
          spellCheck={false}
          placeholder={
            session.worktreePath
              ? "ls -la · pytest · python -m foo · …"
              : "attach a repo to the session to run commands"
          }
          className="flex-1 bg-transparent outline-none text-[13px] font-mono text-fg placeholder:text-fg-3 disabled:opacity-60"
        />
        <button
          onClick={submit}
          disabled={!canRun}
          className="px-3 py-1 rounded text-[11.5px] font-medium text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {busy ? "starting…" : "run"}
        </button>
      </div>
      {err && (
        <div className="px-3 py-2 text-[11px] text-[var(--err)] border-t border-[var(--br-1)] break-words">
          {err}
        </div>
      )}
    </div>
  );
}

function RunsList({ runs }: { runs: Run[] }) {
  // Group consecutive runs that share a sweep_id under a header. Solo
  // runs (no sweepId) render normally.
  type Group =
    | { kind: "single"; run: Run }
    | { kind: "sweep"; sweepId: string; runs: Run[] };

  const groups: Group[] = [];
  for (const r of runs) {
    if (r.sweepId) {
      const last = groups[groups.length - 1];
      if (last && last.kind === "sweep" && last.sweepId === r.sweepId) {
        last.runs.push(r);
        continue;
      }
      groups.push({ kind: "sweep", sweepId: r.sweepId, runs: [r] });
    } else {
      groups.push({ kind: "single", run: r });
    }
  }

  return (
    <div className="space-y-1.5 mb-1">
      {groups.map((g) =>
        g.kind === "single" ? (
          <RunRow key={g.run.id} run={g.run} />
        ) : (
          <SweepGroup key={g.sweepId} runs={g.runs} />
        ),
      )}
    </div>
  );
}

function SweepGroup({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState(true);
  const finished = runs.filter((r) => r.finishedAt != null);
  const passed = finished.filter((r) => r.state === "succeeded").length;
  const inFlight = runs.filter(
    (r) => r.state === "running" || r.state === "starting" || r.state === "queued",
  ).length;
  const scenarioName = runs[0]?.scenarioName ?? "sweep";

  // Aggregate one metric across runs: pick the first numeric metric key.
  let aggKey: string | null = null;
  const values: number[] = [];
  for (const r of runs) {
    if (!r.metrics) continue;
    for (const [k, v] of Object.entries(r.metrics)) {
      if (typeof v === "number") {
        if (aggKey == null) aggKey = k;
        if (k === aggKey) values.push(v);
        break;
      }
    }
  }
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  return (
    <div className="border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--bg-2)] transition"
      >
        <svg
          className={`w-2.5 h-2.5 text-fg-3 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M4 2l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[10px] uppercase tracking-[0.14em] font-medium text-[var(--accent)]">
          sweep · {scenarioName}
        </span>
        <span className="font-mono text-[10.5px] text-fg-3">
          {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1"></div>
        {inFlight > 0 && (
          <span className="text-[10.5px] text-[var(--accent)] font-mono pulse-live">
            {inFlight} in flight
          </span>
        )}
        {finished.length > 0 && (
          <span className="text-[10.5px] font-mono text-fg-2">
            {passed}/{finished.length} pass
          </span>
        )}
        {aggKey && values.length > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={{
              background: "color-mix(in oklch, var(--accent) 12%, var(--bg))",
              border:
                "1px solid color-mix(in oklch, var(--accent) 30%, var(--br-1))",
              color: "var(--fg-1)",
            }}
            title={`range across sweep variants`}
          >
            <span className="text-[var(--accent)] mr-1">{aggKey}</span>
            {formatMetricNumber(aggKey, min!)}–{formatMetricNumber(aggKey, max!)}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-[var(--br-1)] p-1.5 space-y-1.5 bg-[var(--bg)]">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({ run }: { run: Run }) {
  const stateColor = runStateColor(run.state);
  const dotClass = runStateDotClass(run.state);
  const cmd = run.command.join(" ");
  const elapsed =
    run.finishedAt && run.startedAt
      ? `${run.finishedAt - run.startedAt}ms`
      : run.startedAt
        ? "running"
        : "queued";

  // Auto-expand while running, collapse once finished — unless the user
  // explicitly opens it. Matches CommandItemView's pattern.
  const inFlight =
    run.state === "running" ||
    run.state === "starting" ||
    run.state === "queued";
  const [userOpen, setUserOpen] = useState(false);
  const open = userOpen || inFlight;
  const appendManyLogs = useAppStore((s) => s.appendManyLogs);

  // Lazy-load historical logs the first time this row opens (live logs
  // come via WS and live in logsByRun already).
  useEffect(() => {
    if (!open) return;
    const haveLogs = !!useAppStore.getState().logsByRun.get(run.id);
    if (haveLogs) return;
    api
      .getRun(run.id, true)
      .then((res) => {
        if (res.logs && res.logs.length > 0) appendManyLogs(res.logs);
      })
      .catch((err) => console.error("getRun(logs) failed", err));
  }, [open, run.id, appendManyLogs]);

  return (
    <div
      className={`border rounded-lg transition ${
        open
          ? "border-[var(--br-3)] bg-[var(--bg-2)]"
          : "border-[var(--br-1)] bg-[var(--bg-1)] hover:bg-[var(--bg-2)]"
      }`}
    >
      <button
        onClick={() => setUserOpen((o) => !o)}
        className="w-full text-left px-3 py-2"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-2.5 h-2.5 text-fg-3 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
          {run.scenarioName && (
            <span className="text-[10px] uppercase tracking-[0.14em] font-medium text-[var(--accent)] flex-shrink-0">
              {run.scenarioName}
            </span>
          )}
          <span className="font-mono text-[12px] text-fg-1 truncate flex-1 min-w-0">
            {cmd}
          </span>
          <span
            className="font-mono text-[10.5px]"
            style={{ color: stateColor ?? "var(--fg-3)" }}
          >
            {run.state.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-[10.5px] text-fg-3 w-[60px] text-right">
            {elapsed}
          </span>
        </div>
        {(run.sweepVariant || run.metrics) && (
          <div className="mt-1.5 ml-5 flex flex-wrap gap-1.5">
            {run.sweepVariant &&
              Object.entries(run.sweepVariant).map(([k, v]) => (
                <span
                  key={`v-${k}`}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--br-1)] bg-[var(--bg)] font-mono text-fg-3"
                  title={`sweep variant ${k}`}
                >
                  {k}={String(v)}
                </span>
              ))}
            {run.metrics &&
              Object.entries(run.metrics).map(([k, v]) => (
                <MetricChip key={`m-${k}`} name={k} value={v} />
              ))}
          </div>
        )}
      </button>
      {open && (
        <div className="border-t border-[var(--br-1)] p-2 space-y-2">
          <ArtifactPanel run={run} />
          <LogPanel run={run} />
        </div>
      )}
    </div>
  );
}

function MetricChip({
  name,
  value,
}: {
  name: string;
  value: number | string | boolean;
}) {
  const display =
    typeof value === "number"
      ? formatMetricNumber(name, value)
      : String(value);
  return (
    <span
      title={`${name} = ${value}`}
      className="text-[10px] px-1.5 py-0.5 rounded font-mono"
      style={{
        background: "color-mix(in oklch, var(--accent) 12%, var(--bg))",
        border:
          "1px solid color-mix(in oklch, var(--accent) 30%, var(--br-1))",
        color: "var(--fg-1)",
      }}
    >
      <span className="text-[var(--accent)] mr-1">{name}</span>
      {display}
    </span>
  );
}

function formatMetricNumber(name: string, v: number): string {
  if (/rate$|ratio$|pct$/i.test(name) && v <= 1) {
    return `${(v * 100).toFixed(1)}%`;
  }
  if (Number.isInteger(v)) return v.toString();
  if (Math.abs(v) < 0.01) return v.toExponential(2);
  return v.toFixed(2);
}

const EMPTY_LOGS: RunLogEntry[] = [];

function LogPanel({ run }: { run: Run }) {
  const logs = useAppStore((s) => s.logsByRun.get(run.id) ?? EMPTY_LOGS);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
          output
        </div>
        <span className="text-[10.5px] font-mono text-fg-3">
          {logs.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        className="border border-[var(--br-1)] rounded-lg bg-[var(--bg)] p-3 max-h-[400px] overflow-y-auto font-mono text-[11.5px] leading-[1.5]"
      >
        {logs.length === 0 ? (
          <div className="text-fg-3 italic">no output captured yet</div>
        ) : (
          logs.map((entry, i) => <LogLine key={i} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: RunLogEntry }) {
  const color =
    entry.stream === "stderr"
      ? "var(--err)"
      : entry.stream === "system"
        ? "var(--accent)"
        : "var(--fg-1)";
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-words">
      <span className="text-fg-3 select-none w-[44px] flex-shrink-0 text-right">
        {entry.t}ms
      </span>
      <span style={{ color }}>{entry.message}</span>
    </div>
  );
}

// ─── PR block ──────────────────────────────────────────────────────────────

function PrBlock({ session }: { session: Session }) {
  const [draft, setDraft] = useState<{
    title: string;
    body: string;
    commitCount: number;
    filesChanged: string[];
    base: string;
  } | null>(null);
  const [busy, setBusy] = useState<"draft" | "open" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  if (!session.worktreePath) return null;

  const onDraft = async () => {
    setBusy("draft");
    setErr(null);
    try {
      const d = await api.draftPr(session.id);
      setDraft(d);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const onOpen = async () => {
    if (!draft) return;
    setBusy("open");
    setErr(null);
    try {
      const r = await api.openPr(session.id, {
        title: draft.title,
        body: draft.body,
      });
      setUrl(r.url);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
          pull request
        </div>
        {draft && (
          <span className="text-[10.5px] font-mono text-fg-3">
            {draft.commitCount} commit · base {draft.base.replace(/^origin\//, "")}
          </span>
        )}
      </div>

      {!draft ? (
        <button
          onClick={onDraft}
          disabled={busy !== null}
          className="text-[11.5px] text-fg-1 border border-[var(--br-2)] hover:border-[var(--br-3)] hover:bg-[var(--bg-2)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded transition flex items-center gap-1.5"
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 2v6a2 2 0 002 2h2M9 4v6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <circle cx="3" cy="2" r="1.2" fill="currentColor" />
            <circle cx="9" cy="4" r="1.2" fill="currentColor" />
            <circle cx="9" cy="10" r="1.2" fill="currentColor" />
          </svg>
          {busy === "draft" ? "drafting…" : "draft pull request"}
        </button>
      ) : (
        <div className="border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--br-1)]">
            <input
              type="text"
              value={draft.title}
              onChange={(e) =>
                setDraft({ ...draft, title: e.target.value })
              }
              className="w-full bg-transparent outline-none text-[14px] font-medium text-fg"
              placeholder="PR title"
            />
          </div>
          <textarea
            value={draft.body}
            onChange={(e) =>
              setDraft({ ...draft, body: e.target.value })
            }
            rows={14}
            spellCheck={false}
            className="w-full bg-transparent outline-none resize-y font-mono text-[12px] text-fg-1 leading-relaxed px-3 py-2"
          />
          <div className="px-3 py-2 border-t border-[var(--br-1)] flex items-center gap-1.5 bg-[var(--bg)]">
            <button
              onClick={onOpen}
              disabled={busy !== null || url !== null}
              className="text-[11.5px] text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded transition font-medium"
            >
              {busy === "open"
                ? "opening…"
                : url
                  ? "opened"
                  : "push + open PR"}
            </button>
            <button
              onClick={onDraft}
              disabled={busy !== null}
              className="text-[11.5px] text-fg-1 border border-[var(--br-2)] hover:border-[var(--br-3)] hover:bg-[var(--bg-2)] disabled:opacity-50 px-2.5 py-1.5 rounded transition"
            >
              re-draft
            </button>
            <div className="flex-1"></div>
            <button
              onClick={() => {
                setDraft(null);
                setUrl(null);
                setErr(null);
              }}
              disabled={busy !== null}
              className="text-[11.5px] text-fg-3 hover:text-fg-1 px-2 py-1.5 rounded transition"
            >
              discard
            </button>
          </div>
          {url && (
            <div className="px-3 py-2 border-t border-[var(--br-1)] text-[11.5px]">
              opened ·{" "}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline font-mono break-all"
              >
                {url}
              </a>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="mt-2 text-[11px] text-[var(--err)] break-words">
          {err}
        </div>
      )}
    </section>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Fact({
  label,
  value,
  mono,
  breakAll,
}: {
  label: string;
  value: string;
  mono?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className="border border-[var(--br-1)] rounded-lg p-3 bg-[var(--bg-1)]">
      <div className="text-[10px] tracking-[0.16em] uppercase text-fg-3 mb-1.5">
        {label}
      </div>
      <div
        className={`text-[12.5px] ${mono ? "font-mono" : ""} ${breakAll ? "break-all" : "break-words"}`}
      >
        {value}
      </div>
    </div>
  );
}

function labelForSessionKind(kind: Session["kind"]): string {
  return kind === "tracked_task"
    ? "tracked task"
    : kind === "pr_verification"
      ? "pr verification"
      : "freeform";
}

function runStateDotClass(state: RunState): string {
  switch (state) {
    case "running":
    case "starting":
      return "bg-[var(--accent)]";
    case "succeeded":
      return "bg-[var(--ok)]";
    case "failed":
    case "failed_start":
    case "aborted":
      return "bg-[var(--err)]";
    case "paused":
      return "bg-[var(--warn)]";
    default:
      return "bg-[var(--br-3)]";
  }
}

function runStateColor(state: RunState): string | undefined {
  switch (state) {
    case "running":
    case "starting":
      return "var(--accent)";
    case "succeeded":
      return "var(--ok)";
    case "failed":
    case "failed_start":
    case "aborted":
      return "var(--err)";
    case "paused":
      return "var(--warn)";
    default:
      return undefined;
  }
}
