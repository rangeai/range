import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api";
import {
  attemptsForSession,
  runsForAttempt,
  useAppStore,
} from "../lib/store";
import type {
  AgentItem,
  Attempt,
  AttemptState,
  ProfileCommand,
  ProfileLoadResult,
  Run,
  RunLogEntry,
  RunState,
  Session,
} from "@shared/protocol";
import type { ConversationEntry, ConversationState } from "../lib/store";

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions.get(sessionId));
  const attempts = useAppStore((s) => attemptsForSession(s, sessionId));
  const profile = useAppStore((s) => s.profilesBySession.get(sessionId));
  const upsertSession = useAppStore((s) => s.upsertSession);
  const upsertManyAttempts = useAppStore((s) => s.upsertManyAttempts);
  const setProfile = useAppStore((s) => s.setProfile);
  const goHome = useAppStore((s) => s.goHome);

  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!session) {
      api
        .getSession(sessionId)
        .then((res) => upsertSession(res.session))
        .catch((err) => console.error("getSession failed", err));
    }
    api
      .listAttempts(sessionId)
      .then((res) => upsertManyAttempts(res.attempts))
      .catch((err) => console.error("listAttempts failed", err));
    api
      .getProfile(sessionId)
      .then((res) => setProfile(sessionId, res.result))
      .catch((err) => console.error("getProfile failed", err));
  }, [
    sessionId,
    session,
    upsertSession,
    upsertManyAttempts,
    setProfile,
  ]);

  useEffect(() => {
    if (selectedAttemptId) return;
    const last = attempts[attempts.length - 1];
    if (last) setSelectedAttemptId(last.id);
  }, [attempts, selectedAttemptId]);

  const selectedAttempt = useMemo(
    () => attempts.find((a) => a.id === selectedAttemptId) ?? null,
    [attempts, selectedAttemptId],
  );

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-3 text-[13px]">
        loading session {sessionId}…
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <AttemptsSidebar
        session={session}
        attempts={attempts}
        profile={profile}
        selectedAttemptId={selectedAttemptId}
        onSelect={setSelectedAttemptId}
        onBack={goHome}
      />
      <main className="flex-1 overflow-y-auto">
        {selectedAttempt ? (
          <AttemptDetail attempt={selectedAttempt} profile={profile} />
        ) : (
          <EmptyAttempts session={session} />
        )}
      </main>
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function AttemptsSidebar({
  session,
  attempts,
  profile,
  selectedAttemptId,
  onSelect,
  onBack,
}: {
  session: Session;
  attempts: Attempt[];
  profile: ProfileLoadResult | undefined;
  selectedAttemptId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <aside className="w-[300px] border-r border-[var(--br-1)] flex flex-col bg-[var(--bg-1)] flex-shrink-0">
      <div className="p-4 border-b border-[var(--br-1)]">
        <button
          onClick={onBack}
          className="text-[11px] text-fg-3 hover:text-fg-1 mb-3 flex items-center gap-1"
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
            <path
              d="M7 2L3 6l4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          back to home
        </button>
        <div className="text-[10px] tracking-[0.16em] uppercase text-fg-3 mb-1.5">
          {labelForSessionKind(session.kind)}
        </div>
        <div className="font-mono text-[10.5px] text-fg-3 mb-2">
          {session.id}
        </div>
        <h2 className="font-display tracking-tightest text-[15px] font-light leading-snug text-fg mb-2">
          {session.title}
        </h2>
        {session.repoPath ? (
          <div
            className="text-[10.5px] text-fg-3 font-mono break-all"
            title={session.repoPath}
          >
            {session.repoPath}
          </div>
        ) : (
          <div className="text-[10.5px] text-fg-3 italic">
            no repo attached
          </div>
        )}
        <ProfileBadge profile={profile} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <span className="text-[10px] tracking-[0.16em] uppercase text-fg-3 font-medium">
            attempts
          </span>
          <span className="text-[10.5px] font-mono text-fg-3">
            {attempts.length}
          </span>
        </div>

        {attempts.length === 0 ? (
          <div className="px-4 py-2 text-[11.5px] text-fg-3 italic">
            none yet
          </div>
        ) : (
          <div className="space-y-px">
            {attempts.map((a) => (
              <AttemptRow
                key={a.id}
                attempt={a}
                selected={a.id === selectedAttemptId}
                onClick={() => onSelect(a.id)}
              />
            ))}
          </div>
        )}

        <div className="px-4 pt-3 pb-4">
          <CreateAttemptButton sessionId={session.id} />
        </div>
      </div>
    </aside>
  );
}

function ProfileBadge({
  profile,
}: {
  profile: ProfileLoadResult | undefined;
}) {
  if (!profile) return null;
  // No repoPath / no range.yaml — silent, this isn't a parse failure.
  if (!profile.found) return null;
  if (profile.error) {
    return (
      <div
        className="mt-2 text-[10.5px] text-[var(--err)]"
        title={profile.error}
      >
        profile parse error
      </div>
    );
  }
  const count = profile.profile?.commands.length ?? 0;
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-fg-2">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: "var(--ok)" }}
      />
      <span>range.yaml</span>
      <span className="text-fg-3">·</span>
      <span className="font-mono">{count} commands</span>
    </div>
  );
}

function AttemptRow({
  attempt,
  selected,
  onClick,
}: {
  attempt: Attempt;
  selected: boolean;
  onClick: () => void;
}) {
  const accent = attemptStateBarClass(attempt.state);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2.5 flex gap-3 transition ${
        selected ? "bg-[var(--bg-2)]" : "hover:bg-[var(--bg-2)]"
      }`}
    >
      <div className={`w-[2px] self-stretch rounded ${accent}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[12px] text-fg-1 truncate">
            {attempt.name}
          </span>
          {attempt.isCandidate && (
            <span className="text-[9px] uppercase tracking-wider text-[var(--accent)] font-medium">
              candidate
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] text-fg-3 font-mono">
          <span>{attempt.kind}</span>
          <span>·</span>
          <span>{attempt.state.replace(/_/g, " ")}</span>
        </div>
      </div>
    </button>
  );
}

function CreateAttemptButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createAttempt(sessionId, {
        kind: "freeform",
        sandbox: "read-only",
      });
    } catch (e) {
      console.error("createAttempt failed", e);
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={onClick}
        disabled={busy}
        className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-[var(--br-1)] hover:border-[var(--br-2)] hover:bg-[var(--bg-2)] rounded text-[12px] text-fg-2 hover:text-fg disabled:opacity-60 transition"
      >
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6h7M6 2.5v7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        {busy ? "creating…" : "new attempt"}
      </button>
      {err && (
        <div className="mt-2 text-[10.5px] text-[var(--err)] break-words">
          {err}
        </div>
      )}
    </div>
  );
}

// ─── Detail pane ────────────────────────────────────────────────────────────

function AttemptDetail({
  attempt,
  profile,
}: {
  attempt: Attempt;
  profile: ProfileLoadResult | undefined;
}) {
  const runs = useAppStore((s) => runsForAttempt(s, attempt.id));
  const upsertManyRuns = useAppStore((s) => s.upsertManyRuns);
  const appendManyLogs = useAppStore((s) => s.appendManyLogs);

  useEffect(() => {
    api
      .listRuns(attempt.id)
      .then((res) => upsertManyRuns(res.runs))
      .catch((err) => console.error("listRuns failed", err));
  }, [attempt.id, upsertManyRuns]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !runs.find((r) => r.id === selectedRunId)) {
      setSelectedRunId(runs[runs.length - 1]!.id);
    }
  }, [runs, selectedRunId]);

  // When the user selects an older run we may not have its logs in memory yet.
  useEffect(() => {
    if (!selectedRunId) return;
    const haveLogs = !!useAppStore.getState().logsByRun.get(selectedRunId);
    if (haveLogs) return;
    api
      .getRun(selectedRunId, true)
      .then((res) => {
        if (res.logs && res.logs.length > 0) appendManyLogs(res.logs);
      })
      .catch((err) => console.error("getRun(logs) failed", err));
  }, [selectedRunId, appendManyLogs]);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-2">
        attempt
      </div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="font-display tracking-tightest text-[28px] font-light leading-tight">
          {attempt.name}
        </h1>
        {attempt.isCandidate && (
          <span className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium">
            candidate
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <Fact label="id" value={attempt.id} mono />
        <Fact label="kind" value={attempt.kind} />
        <Fact
          label="state"
          value={attempt.state.replace(/_/g, " ")}
          accent={attemptStateColor(attempt.state)}
        />
        <Fact label="sandbox" value={attempt.sandbox} />
        <Fact
          label="branch"
          value={attempt.branch ?? "—"}
          mono={!!attempt.branch}
        />
        <Fact
          label="base sha"
          value={attempt.baseSha?.slice(0, 12) ?? "—"}
          mono={!!attempt.baseSha}
        />
      </div>

      {attempt.worktreePath ? (
        <div className="border border-[var(--br-1)] rounded-lg p-4 bg-[var(--bg-1)] mb-8">
          <div className="text-[10px] tracking-[0.16em] uppercase text-fg-3 mb-2">
            worktree
          </div>
          <div className="font-mono text-[12px] text-fg-1 break-all">
            {attempt.worktreePath}
          </div>
          {!attempt.baseSha && (
            <div className="text-[11px] text-[var(--warn)] mt-2">
              worktree path reserved but not a real git worktree — attach a
              repo to the session and recreate the attempt.
            </div>
          )}
        </div>
      ) : (
        <div className="border border-dashed border-[var(--br-1)] rounded-lg p-4 bg-[var(--bg-1)]/40 mb-8">
          <div className="text-[12px] text-fg-2 leading-relaxed">
            no worktree — this session has no{" "}
            <span className="font-mono">repo_path</span>. attach one to enable
            real git worktrees for new attempts.
          </div>
        </div>
      )}

      <ConversationPanel attempt={attempt} />

      <RunsPanel
        attempt={attempt}
        runs={runs}
        profile={profile}
        selectedRunId={selectedRunId}
        onSelectRun={setSelectedRunId}
      />

      {selectedRun && <LogPanel run={selectedRun} />}
    </div>
  );
}

// ─── Conversation panel (Codex agent) ──────────────────────────────────────

function ConversationPanel({ attempt }: { attempt: Attempt }) {
  const conv = useAppStore(
    (s) => s.conversationsByAttempt.get(attempt.id) ?? EMPTY_CONV,
  );

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
            conversation
          </span>
          <ConversationStatusChip conv={conv} />
        </div>
        <AgentControls attempt={attempt} conv={conv} />
      </div>

      <ConversationTimeline conv={conv} />

      <MessageComposer attempt={attempt} conv={conv} />
    </div>
  );
}

const EMPTY_CONV: ConversationState = {
  status: "stopped",
  threadId: null,
  turnInFlight: false,
  error: null,
  entries: [],
};

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
  attempt,
  conv,
}: {
  attempt: Attempt;
  conv: ConversationState;
}) {
  const patch = useAppStore((s) => s.patchConversation);
  const pushSystem = useAppStore((s) => s.pushSystemEntry);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (busy || !attempt.worktreePath) return;
    setBusy(true);
    patch(attempt.id, { status: "starting", error: null });
    try {
      await api.startAgent(attempt.id);
      // agent_started WS event will flip to "running"
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      patch(attempt.id, { status: "error", error: msg });
      pushSystem(attempt.id, `start failed · ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.stopAgent(attempt.id);
    } catch (e) {
      console.error("stop agent failed", e);
    } finally {
      setBusy(false);
    }
  };

  const running = conv.status === "running" || conv.status === "starting";
  const noWorktree = !attempt.worktreePath;

  return (
    <div className="flex items-center gap-1.5">
      {!running ? (
        <button
          onClick={start}
          disabled={busy || noWorktree}
          title={noWorktree ? "attach a repo to enable Codex" : undefined}
          className="text-[11px] text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded transition flex items-center gap-1.5 font-medium"
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3 2v8l7-4z" />
          </svg>
          {busy ? "starting…" : "start codex"}
        </button>
      ) : (
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
      )}
    </div>
  );
}

function ConversationTimeline({ conv }: { conv: ConversationState }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conv.entries.length]);

  if (conv.entries.length === 0 && conv.status === "stopped") {
    return (
      <div className="border border-dashed border-[var(--br-1)] rounded-lg p-6 mb-3 bg-[var(--bg-1)]/40">
        <div className="text-[12.5px] text-fg-2 leading-relaxed">
          Codex hasn't started for this attempt yet. Click <span className="text-fg-1 font-medium">start codex</span>{" "}
          to spawn{" "}
          <span className="font-mono text-[12px] text-fg-3">codex app-server</span>{" "}
          in the attempt's worktree. Phase A: sandbox is{" "}
          <span className="font-mono">read-only</span>, approvals are auto-accepted.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] mb-3 overflow-y-auto max-h-[460px] p-4 space-y-4"
    >
      {conv.entries.map((entry, i) => (
        <ConversationEntryView key={i} entry={entry} />
      ))}
      {conv.status === "error" && conv.error && (
        <div className="text-[11.5px] text-[var(--err)] border border-[var(--err)]/40 bg-[var(--err)]/10 rounded p-2 break-words">
          {conv.error}
        </div>
      )}
    </div>
  );
}

function ConversationEntryView({ entry }: { entry: ConversationEntry }) {
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
  return <AgentItemView item={entry.item} />;
}

function AgentItemView({ item }: { item: AgentItem }) {
  const inProgress = item.state === "started";
  switch (item.kind) {
    case "message":
      return (
        <div className="flex gap-3">
          <AgentBadge label="cdx" />
          <div className="flex-1 min-w-0 text-[13.5px] text-fg-1 leading-relaxed whitespace-pre-wrap break-words">
            {item.text || (inProgress ? "…" : "")}
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
          <div className="flex-1 min-w-0 text-[12px] text-fg-3 italic leading-relaxed whitespace-pre-wrap break-words">
            {item.text || (inProgress ? "thinking…" : "")}
          </div>
        </div>
      );
    case "command": {
      const cmd =
        typeof item.command === "string"
          ? item.command
          : item.command.join(" ");
      return (
        <div className="flex gap-3">
          <AgentBadge label="$" />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[12px] text-fg-1 break-words">
              {cmd}
            </div>
            {item.state === "completed" && (
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-fg-3 font-mono">
                <span
                  style={{
                    color:
                      item.exitCode === 0
                        ? "var(--ok)"
                        : item.exitCode == null
                          ? undefined
                          : "var(--err)",
                  }}
                >
                  exit {item.exitCode ?? "?"}
                </span>
                {item.durationMs != null && (
                  <>
                    <span>·</span>
                    <span>{item.durationMs}ms</span>
                  </>
                )}
              </div>
            )}
            {item.output && item.state === "completed" && (
              <pre className="mt-2 font-mono text-[11px] text-fg-2 bg-[var(--bg)] border border-[var(--br-1)] rounded p-2 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words">
                {item.output}
              </pre>
            )}
          </div>
        </div>
      );
    }
    case "file_edit":
      return (
        <div className="flex gap-3">
          <AgentBadge label="✎" />
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
          <AgentBadge label="t" />
          <div className="flex-1 min-w-0 text-[12px] text-fg-1 font-mono">
            mcp · {item.server ?? "?"}:{item.tool ?? "?"}
          </div>
        </div>
      );
    case "web_search":
      return (
        <div className="flex gap-3">
          <AgentBadge label="?" />
          <div className="flex-1 min-w-0 text-[12px] text-fg-1">
            web search · {item.query ?? "(no query)"}
          </div>
        </div>
      );
    default:
      return (
        <div className="text-[11px] text-fg-3 italic">
          unknown agent item
        </div>
      );
  }
}

function AgentBadge({ label }: { label: string }) {
  return (
    <div className="w-7 h-7 flex-shrink-0 rounded bg-[var(--bg-2)] border border-[var(--br-2)] text-[10.5px] flex items-center justify-center font-mono text-fg-1">
      {label}
    </div>
  );
}

function MessageComposer({
  attempt,
  conv,
}: {
  attempt: Attempt;
  conv: ConversationState;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const pushUserMessage = useAppStore((s) => s.pushUserMessage);
  const patch = useAppStore((s) => s.patchConversation);

  const canSend =
    conv.status === "running" && !conv.turnInFlight && text.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSend) return;
    const prompt = text.trim();
    setBusy(true);
    pushUserMessage(attempt.id, prompt);
    setText("");
    try {
      await api.sendAgentMessage(attempt.id, prompt);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      patch(attempt.id, { error: msg, turnInFlight: false });
    } finally {
      setBusy(false);
    }
  };

  const placeholder =
    conv.status === "stopped"
      ? "start Codex to send a message"
      : conv.status === "starting"
        ? "Codex is starting…"
        : conv.turnInFlight
          ? "Codex is working on the previous turn…"
          : "ask Codex to investigate, explain, or run commands…";

  return (
    <div className="border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={conv.status !== "running" || conv.turnInFlight}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-transparent outline-none resize-none text-[13px] text-fg placeholder:text-fg-3 leading-relaxed disabled:opacity-60 px-3 py-2"
      />
      <div className="px-3 py-1.5 border-t border-[var(--br-1)] flex items-center gap-2 bg-[var(--bg)]">
        <span className="text-[10.5px] text-fg-3">⏎ to send · ⇧⏎ newline</span>
        <div className="flex-1"></div>
        <button
          onClick={submit}
          disabled={!canSend}
          className="text-[11px] text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded transition font-medium"
        >
          send
        </button>
      </div>
    </div>
  );
}

function RunsPanel({
  attempt,
  runs,
  profile,
  selectedRunId,
  onSelectRun,
}: {
  attempt: Attempt;
  runs: Run[];
  profile: ProfileLoadResult | undefined;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
}) {
  const profileCommands = profile?.profile?.commands ?? [];
  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
          runs
        </div>
        <span className="text-[10.5px] font-mono text-fg-3">{runs.length}</span>
      </div>

      {profileCommands.length > 0 && (
        <ProfileCommandStrip
          attempt={attempt}
          commands={profileCommands}
        />
      )}

      <RunLauncher attempt={attempt} />

      {runs.length > 0 && (
        <div className="space-y-1.5 mb-1">
          {runs.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              selected={r.id === selectedRunId}
              onClick={() => onSelectRun(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileCommandStrip({
  attempt,
  commands,
}: {
  attempt: Attempt;
  commands: ProfileCommand[];
}) {
  const [busyName, setBusyName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const launch = async (cmd: ProfileCommand) => {
    if (!attempt.worktreePath) return;
    setBusyName(cmd.name);
    setErr(null);
    try {
      await api.createRun(attempt.id, {
        command: cmd.args,
        kind: "shell",
      });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusyName(null);
    }
  };

  const disabled = !attempt.worktreePath;

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

function RunLauncher({ attempt }: { attempt: Attempt }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canRun = !!attempt.worktreePath && command.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canRun) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createRun(attempt.id, { command: command.trim(), kind: "shell" });
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
          disabled={!attempt.worktreePath || busy}
          spellCheck={false}
          placeholder={
            attempt.worktreePath
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
      <div className="px-3 py-1.5 text-[10.5px] text-fg-3 flex items-center gap-2">
        <span>runs inside</span>
        <span className="font-mono break-all">
          {attempt.worktreePath ?? "—"}
        </span>
      </div>
      {err && (
        <div className="px-3 py-2 text-[11px] text-[var(--err)] border-t border-[var(--br-1)] break-words">
          {err}
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  selected,
  onClick,
}: {
  run: Run;
  selected: boolean;
  onClick: () => void;
}) {
  const stateColor = runStateColor(run.state);
  const dotClass = runStateDotClass(run.state);
  const cmd = run.command.join(" ");
  const elapsed =
    run.finishedAt && run.startedAt
      ? `${run.finishedAt - run.startedAt}ms`
      : run.startedAt
        ? "running"
        : "queued";
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 border rounded-lg flex items-center gap-3 transition ${
        selected
          ? "border-[var(--br-3)] bg-[var(--bg-2)]"
          : "border-[var(--br-1)] bg-[var(--bg-1)] hover:bg-[var(--bg-2)]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
      <span className="font-mono text-[12px] text-fg-1 truncate flex-1">
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
    </button>
  );
}

function LogPanel({ run }: { run: Run }) {
  const logs = useAppStore(
    (s) => s.logsByRun.get(run.id) ?? EMPTY_LOGS,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new log entries
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <div className="mb-8">
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

const EMPTY_LOGS: RunLogEntry[] = [];

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

function EmptyAttempts({ session }: { session: Session }) {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-3">
        no attempts yet
      </div>
      <h2 className="font-display tracking-tightest text-[28px] font-light leading-tight mb-3">
        an attempt is{" "}
        <span className="italic text-fg-2">where the work happens.</span>
      </h2>
      <p className="text-[14px] text-fg-2 leading-relaxed max-w-md mx-auto">
        each attempt is an isolated branch of work inside this session — its
        own git worktree, its own agent thread, its own evidence. create one to
        begin.
      </p>
      {!session.repoPath && (
        <div className="mt-6 text-[11.5px] text-fg-3 italic">
          (this session has no repo_path — the first attempt will be
          metadata-only)
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Fact({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: string;
}) {
  return (
    <div className="border border-[var(--br-1)] rounded-lg p-3 bg-[var(--bg-1)]">
      <div className="text-[10px] tracking-[0.16em] uppercase text-fg-3 mb-1.5">
        {label}
      </div>
      <div
        className={`text-[13px] break-words ${mono ? "font-mono" : ""}`}
        style={accent ? { color: accent } : undefined}
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
      : "freeform session";
}

function attemptStateBarClass(state: AttemptState): string {
  switch (state) {
    case "verification_passed":
    case "pr_opened":
      return "bg-[var(--ok)]";
    case "verification_failed":
      return "bg-[var(--err)]";
    case "agent_running":
    case "running_command":
      return "bg-[var(--accent)]";
    case "waiting_for_user":
    case "paused":
    case "verification_pending":
      return "bg-[var(--warn)]";
    case "archived":
      return "bg-[var(--fg-3)]";
    default:
      return "bg-[var(--br-2)]";
  }
}

function attemptStateColor(state: AttemptState): string | undefined {
  switch (state) {
    case "verification_passed":
    case "pr_opened":
      return "var(--ok)";
    case "verification_failed":
      return "var(--err)";
    case "agent_running":
    case "running_command":
      return "var(--accent)";
    case "waiting_for_user":
    case "paused":
    case "verification_pending":
      return "var(--warn)";
    default:
      return undefined;
  }
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
