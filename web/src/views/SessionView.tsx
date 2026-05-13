import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import * as api from "../lib/api";
import { runsForSession, useAppStore } from "../lib/store";
import { useWsSend } from "../lib/ws";
import { Markdown } from "./Markdown";
import type {
  AgentItem,
  ProfileCommand,
  ProfileLoadResult,
  Run,
  RunLogEntry,
  RunState,
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

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <SessionHeader session={session} profile={profile} />
      <WorktreeBlock session={session} />
      <ConversationBlock session={session} />
      <RunsBlock session={session} profile={profile} />
      <PrBlock session={session} />
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
  if (!session.worktreePath) return null;
  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      <Fact
        label="worktree"
        value={session.worktreePath}
        mono
        breakAll
      />
      <Fact
        label="branch"
        value={session.branch ?? "—"}
        mono={!!session.branch}
      />
      <Fact
        label="base"
        value={session.baseSha?.slice(0, 12) ?? "—"}
        mono={!!session.baseSha}
      />
      <Fact label="sandbox" value={session.sandbox} />
    </div>
  );
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
      <MessageComposer session={session} conv={conv} />
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
          Codex is warming up… the thread will appear here once it's ready.
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
  return <AgentItemView item={entry.item} />;
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
      <AgentBadge label="!" />
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
  session,
  conv,
}: {
  session: Session;
  conv: ConversationState;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pushUserMessage = useAppStore((s) => s.pushUserMessage);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const patch = useAppStore((s) => s.patchConversation);

  const canSend =
    conv.status === "running" &&
    !conv.turnInFlight &&
    text.trim().length > 0 &&
    !busy;

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

  const onPickRepo = async (path: string) => {
    setPickerOpen(false);
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
      ? "start Codex to send a message"
      : conv.status === "starting"
        ? "Codex is starting…"
        : conv.turnInFlight
          ? "Codex is working on the previous turn…"
          : "ask Codex to investigate, explain, or run commands…";

  const noRepo = !session.worktreePath;

  return (
    <>
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
          {noRepo && (
            <button
              onClick={() => setPickerOpen(true)}
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
          <button
            onClick={submit}
            disabled={!canSend}
            className="text-[11px] text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded transition font-medium"
          >
            send
          </button>
        </div>
      </div>
      {pickerOpen && (
        <RepoPicker
          onPick={onPickRepo}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
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
  const appendManyLogs = useAppStore((s) => s.appendManyLogs);
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

  const profileCommands = profile?.profile?.commands ?? [];
  const gates = profile?.profile?.gates ?? [];

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 font-medium">
          runs
        </div>
        <span className="text-[10.5px] font-mono text-fg-3">{runs.length}</span>
      </div>

      {gates.length > 0 && (
        <VerificationStrip sessionId={session.id} gates={gates} />
      )}

      {profileCommands.length > 0 && (
        <ProfileCommandStrip session={session} commands={profileCommands} />
      )}

      <RunLauncher session={session} />

      {runs.length > 0 && (
        <div className="space-y-1.5 mb-1">
          {runs.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              selected={r.id === selectedRunId}
              onClick={() => setSelectedRunId(r.id)}
            />
          ))}
        </div>
      )}

      {selectedRun && <LogPanel run={selectedRun} />}
    </section>
  );
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
