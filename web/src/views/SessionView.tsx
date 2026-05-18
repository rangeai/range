import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import * as api from "../lib/api";
import { useAppStore } from "../lib/store";
import { applyServerMessage, useWsSend } from "../lib/ws";
import { Markdown } from "./Markdown";
import type {
  AgentItem,
  ArtifactInfo,
  ProfileLoadResult,
  Run,
  RunLogEntry,
  RunState,
  Sandbox,
  Session,
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

    // Verification results are read from disk on the server side; pull
    // them here so any inline card that wants to render them has data.
    api
      .getVerification(sessionId)
      .then((res) =>
        useAppStore.getState().setVerificationResults(sessionId, res.results),
      )
      .catch((err) => console.error("getVerification failed", err));

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
  return (
    <div className="h-full flex flex-col overflow-hidden">
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
        <CodexPills session={session} />
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
        <div className="border-t border-[var(--br-1)] bg-[var(--bg)]">
          <div className="px-3 py-3 grid grid-cols-2 gap-3">
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
          <SandboxSwitcher session={session} />
          <ApprovalSettings session={session} />
        </div>
      )}
    </div>
  );
}

function SandboxSwitcher({ session }: { session: Session }) {
  const upsertSession = useAppStore((s) => s.upsertSession);
  const [busy, setBusy] = useState(false);
  const choices: Array<{
    value: import("@shared/protocol").Sandbox;
    label: string;
    hint: string;
  }> = [
    {
      value: "read-only",
      label: "read-only",
      hint: "Codex can read + run safe commands; no file edits",
    },
    {
      value: "workspace-write",
      label: "workspace-write",
      hint: "Codex can edit files; you approve each write",
    },
    {
      value: "danger-full-access",
      label: "danger",
      hint: "no sandbox · Codex can do anything",
    },
  ];

  const change = async (next: import("@shared/protocol").Sandbox) => {
    if (busy || next === session.sandbox) return;
    setBusy(true);
    try {
      const res = await api.setSandbox(session.id, next);
      upsertSession(res.session);
    } catch (e) {
      console.error("setSandbox failed", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-[var(--br-1)] px-3 py-2.5 flex items-center gap-3">
      <span className="text-[10px] tracking-[0.16em] uppercase text-fg-3 flex-shrink-0">
        sandbox
      </span>
      <div className="flex gap-1">
        {choices.map((c) => {
          const isCurrent = c.value === session.sandbox;
          return (
            <button
              key={c.value}
              onClick={() => change(c.value)}
              disabled={busy || isCurrent}
              title={c.hint}
              className={`text-[10.5px] px-2 py-0.5 rounded border transition ${
                isCurrent
                  ? c.value === "danger-full-access"
                    ? "text-[var(--bg)] bg-[var(--err)] border-[var(--err)]"
                    : "text-[var(--bg)] bg-[var(--accent)] border-[var(--accent)]"
                  : "text-fg-1 border-[var(--br-2)] hover:border-[var(--br-3)] hover:bg-[var(--bg-2)] disabled:opacity-50"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {busy && (
        <span className="text-[10.5px] text-fg-3 italic">restarting codex…</span>
      )}
    </div>
  );
}

function ApprovalSettings({ session }: { session: Session }) {
  const upsertSession = useAppStore((s) => s.upsertSession);
  const [busy, setBusy] = useState(false);

  const toggleAutoApprove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.setAutoApprove(session.id, !session.autoApprove);
      upsertSession(res.session);
    } catch (e) {
      console.error("setAutoApprove failed", e);
    } finally {
      setBusy(false);
    }
  };

  const removeBinary = async (binary: string) => {
    try {
      const res = await api.disallowCommand(session.id, binary);
      upsertSession(res.session);
    } catch (e) {
      console.error("disallowCommand failed", e);
    }
  };

  const modeLabel = session.autoApprove
    ? "auto-approve all"
    : session.allowedCommands.length > 0
      ? `auto-allowed: ${session.allowedCommands.join(", ")}`
      : "ask for every command";

  return (
    <div className="border-t border-[var(--br-1)] px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] tracking-[0.16em] uppercase text-fg-3">
          approvals
        </span>
        <span className="text-[11px] text-fg-2 truncate flex-1">
          {modeLabel}
        </span>
        <button
          onClick={toggleAutoApprove}
          disabled={busy}
          title={
            session.autoApprove
              ? "stop auto-approving · ask for every command again"
              : "auto-approve everything · Codex will not pause"
          }
          className={`text-[10.5px] px-2 py-0.5 rounded border transition ${
            session.autoApprove
              ? "text-[var(--bg)] bg-[var(--warn)] border-[var(--warn)]"
              : "text-fg-1 border-[var(--br-2)] hover:border-[var(--br-3)] hover:bg-[var(--bg-2)]"
          }`}
        >
          {session.autoApprove ? "auto-approve · on" : "auto-approve · off"}
        </button>
      </div>
      {!session.autoApprove && session.allowedCommands.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {session.allowedCommands.map((b) => (
            <span
              key={b}
              className="inline-flex items-center gap-1 text-[10.5px] font-mono px-1.5 py-0.5 rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)]"
            >
              <span>{b}</span>
              <button
                onClick={() => removeBinary(b)}
                className="text-fg-3 hover:text-[var(--err)] leading-none"
                title={`stop auto-approving ${b}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CodexPills({ session }: { session: Session }) {
  const usage = useAppStore((s) => s.tokenUsageBySession.get(session.id));
  const pills: Array<{ label: string; value: string; title: string }> = [];
  // Backend is always shown so it's obvious which agent is driving.
  pills.push({
    label: "agent",
    value: session.backend,
    title:
      session.backend === "opencode"
        ? "OpenCode — provider-agnostic OSS agent (any LLM)"
        : "Codex — OpenAI's agent CLI",
  });
  if (session.model) {
    pills.push({
      label: "model",
      value: session.model,
      title: `Model: ${session.model}`,
    });
  }
  if (session.reasoningEffort) {
    pills.push({
      label: "think",
      value: session.reasoningEffort,
      title: `Reasoning effort: ${session.reasoningEffort}`,
    });
  }
  if (usage) {
    const total = usage.total.totalTokens;
    const ctx = usage.modelContextWindow;
    const value = ctx
      ? `${formatTokens(total)} / ${formatTokens(ctx)}`
      : formatTokens(total);
    pills.push({
      label: "tokens",
      value,
      title:
        `total ${total.toLocaleString()} tokens` +
        (ctx ? ` of ${ctx.toLocaleString()} context window` : "") +
        ` · last turn in/out/think: ` +
        `${usage.last.inputTokens.toLocaleString()}/` +
        `${usage.last.outputTokens.toLocaleString()}/` +
        `${usage.last.reasoningOutputTokens.toLocaleString()}`,
    });
  }
  if (pills.length === 0) return null;
  return (
    <>
      {pills.map((p) => (
        <span
          key={p.label}
          title={p.title}
          className="flex-shrink-0 text-[10.5px] font-mono px-1.5 py-0.5 rounded border"
          style={{
            color: "var(--accent)",
            borderColor:
              "color-mix(in oklch, var(--accent) 30%, var(--br-1))",
            background: "color-mix(in oklch, var(--accent) 10%, var(--bg))",
          }}
        >
          <span className="text-fg-3 mr-1">{p.label}</span>
          {p.value}
        </span>
      ))}
    </>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
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

// ─── /transcript renderer ──────────────────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function fmtCommand(cmd: string | string[]): string {
  return Array.isArray(cmd) ? cmd.join(" ") : cmd;
}

function renderConversationAsMarkdown(opts: {
  session: Session;
  entries: ConversationEntry[];
  runs: Map<string, Run>;
}): string {
  const { session, entries, runs } = opts;
  const out: string[] = [];

  out.push(`# Range session transcript`);
  out.push("");
  out.push(`- **Session:** \`${session.id}\``);
  if (session.title) out.push(`- **Title:** ${session.title}`);
  if (session.repoPath) out.push(`- **Repo:** \`${session.repoPath}\``);
  out.push(`- **Backend:** ${session.backend ?? "codex"}`);
  if (session.model) out.push(`- **Model:** ${session.model}`);
  out.push(`- **Created:** ${fmtTime(session.createdAt)}`);
  out.push("");
  out.push("---");
  out.push("");

  for (const entry of entries) {
    if (entry.kind === "user") {
      out.push(`### You · ${fmtTime(entry.t)}`);
      out.push("");
      out.push(entry.text);
      out.push("");
    } else if (entry.kind === "system") {
      out.push(`> _${entry.text}_  \`(${fmtTime(entry.t)})\``);
      out.push("");
    } else if (entry.kind === "turn") {
      const ok = entry.status === "ok" ? "✓" : entry.status;
      out.push(`---`);
      out.push(`#### Turn ${ok} · ${fmtTime(entry.t)}`);
      if (entry.prompt) {
        out.push("");
        out.push(`> ${entry.prompt.split("\n").join("\n> ")}`);
      }
      out.push("");
    } else if (entry.kind === "agent_item") {
      const item = entry.item;
      if (item.kind === "message") {
        out.push(`**Agent:**`);
        out.push("");
        out.push(item.text);
        out.push("");
      } else if (item.kind === "reasoning") {
        out.push(`<details><summary>reasoning</summary>`);
        out.push("");
        out.push(item.text);
        out.push("");
        out.push(`</details>`);
        out.push("");
      } else if (item.kind === "command") {
        const exit =
          item.exitCode === undefined || item.exitCode === null
            ? "?"
            : item.exitCode;
        out.push(
          `\`\`\`bash\n# exit ${exit}${item.durationMs ? ` · ${item.durationMs}ms` : ""}\n$ ${fmtCommand(item.command)}\n\`\`\``,
        );
        if (item.output) {
          out.push("");
          out.push("```");
          out.push(item.output.slice(0, 4000));
          out.push("```");
        }
        out.push("");
      } else if (item.kind === "file_edit") {
        out.push(
          `📝 **${item.changeKind}** \`${item.path}\`${item.summary ? ` — ${item.summary}` : ""}`,
        );
        out.push("");
      } else if (item.kind === "mcp_tool") {
        out.push(`🔌 MCP tool \`${item.server ?? "?"}/${item.tool ?? "?"}\``);
        if (item.output) {
          out.push("");
          out.push("```");
          out.push(item.output.slice(0, 2000));
          out.push("```");
        }
        out.push("");
      } else if (item.kind === "web_search") {
        out.push(`🔎 Web search: \`${item.query ?? "?"}\``);
        out.push("");
      }
    } else if (entry.kind === "run") {
      const run = runs.get(entry.runId);
      if (run) {
        const elapsed =
          run.startedAt && run.finishedAt
            ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`
            : run.state;
        out.push(
          `▶ **Run** \`${run.scenarioName ?? "(custom)"}\` · ${run.state} · ${elapsed}`,
        );
        out.push("");
        out.push(`\`\`\`\n${fmtCommand(run.command)}\n\`\`\``);
        out.push("");
      } else {
        out.push(`▶ Run \`${entry.runId}\` (not loaded)`);
        out.push("");
      }
    } else if (entry.kind === "scaffold_proposal") {
      out.push(
        `📋 Scaffold proposal · ${entry.proposal.stackLabel} · ${entry.status ?? "pending"}`,
      );
      out.push("");
    } else if (entry.kind === "wire_proposal") {
      out.push(`🪛 Wire proposal · ${entry.status ?? "pending"}`);
      out.push("");
    } else if (entry.kind === "approval") {
      out.push(
        `⚠️ Approval (${entry.approval.kind}) · ${entry.approval.decision ?? "pending"}`,
      );
      out.push("");
    } else if (entry.kind === "pr_draft") {
      out.push(`🔁 PR draft`);
      out.push("");
    }
  }

  out.push("");
  out.push(`_Exported ${fmtTime(Date.now())} by Range \`/transcript\`._`);
  out.push("");
  return out.join("\n");
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

  // Walk entries and group everything between a `turn` marker and the
  // next `turn`/`user` into that turn's children. The user message that
  // preceded a turn is *not* sucked in — it renders normally above the
  // turn card so the prompt stays visible even when the turn collapses.
  type Block =
    | { kind: "loose"; entry: ConversationEntry; idx: number }
    | {
        kind: "turn";
        turn: Extract<ConversationEntry, { kind: "turn" }>;
        items: { entry: ConversationEntry; idx: number }[];
        idx: number;
      };
  // Memoized on the entries reference. The store hands us a new array
  // on every change (delta, new entry, turn boundary), so identity
  // equality is the right key — when nothing changed, we reuse the
  // previous grouping without re-walking.
  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    let openTurn: Extract<Block, { kind: "turn" }> | null = null;
    conv.entries.forEach((entry, idx) => {
      if (entry.kind === "turn") {
        openTurn = { kind: "turn", turn: entry, items: [], idx };
        out.push(openTurn);
      } else if (entry.kind === "user") {
        openTurn = null;
        out.push({ kind: "loose", entry, idx });
      } else if (openTurn) {
        openTurn.items.push({ entry, idx });
      } else {
        out.push({ kind: "loose", entry, idx });
      }
    });
    return out;
  }, [conv.entries]);

  return (
    <div className="border border-[var(--br-1)] rounded-lg bg-[var(--bg-1)] p-4 space-y-4">
      {blocks.map((b) =>
        b.kind === "loose" ? (
          <ConversationEntryView
            key={`e${b.idx}`}
            entry={b.entry}
            sessionId={sessionId}
          />
        ) : (
          <TurnCard
            key={`t${b.idx}-${b.turn.turnId}`}
            turn={b.turn}
            items={b.items}
            sessionId={sessionId}
          />
        ),
      )}
      {conv.status === "error" && conv.error && (
        <div className="text-[11.5px] text-[var(--err)] border border-[var(--err)]/40 bg-[var(--err)]/10 rounded p-2 break-words">
          {conv.error}
        </div>
      )}
    </div>
  );
}

function TurnCard({
  turn,
  items,
  sessionId,
}: {
  turn: Extract<ConversationEntry, { kind: "turn" }>;
  items: { entry: ConversationEntry; idx: number }[];
  sessionId: string;
}) {
  const inFlight = turn.status === "running";
  // Auto-collapse on completion; user can still toggle.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? inFlight;

  // Summary counts for the header.
  let cmds = 0;
  let edits = 0;
  let reasoning = 0;
  let messages = 0;
  let lastMessage: string | null = null;
  for (const { entry } of items) {
    if (entry.kind !== "agent_item") continue;
    const k = entry.item.kind;
    if (k === "command") cmds++;
    else if (k === "file_edit") edits++;
    else if (k === "reasoning") reasoning++;
    else if (k === "message") {
      messages++;
      if (entry.item.text) lastMessage = entry.item.text;
    }
  }

  const durationS =
    turn.finishedAt !== null
      ? Math.max(0, (turn.finishedAt - turn.startedAt) / 1000)
      : null;
  const statusColor =
    turn.status === "ok"
      ? "var(--ok)"
      : turn.status === "failed" || turn.status === "aborted"
        ? "var(--err)"
        : "var(--accent)";

  const summaryParts: string[] = [];
  if (cmds) summaryParts.push(`${cmds} cmd${cmds === 1 ? "" : "s"}`);
  if (edits) summaryParts.push(`${edits} edit${edits === 1 ? "" : "s"}`);
  if (reasoning) summaryParts.push(`${reasoning} thought${reasoning === 1 ? "" : "s"}`);
  if (messages) summaryParts.push(`${messages} msg${messages === 1 ? "" : "s"}`);
  const summary = summaryParts.length === 0 ? "no activity" : summaryParts.join(" · ");

  // First non-empty line of the agent's last message, truncated.
  const lastMsgPreview = lastMessage
    ? lastMessage
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0)
        ?.slice(0, 120) ?? null
    : null;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition ${
        open
          ? "border-[var(--br-2)] bg-[var(--bg-1)]"
          : "border-[var(--br-1)] bg-[var(--bg-1)] hover:bg-[var(--bg-2)]"
      }`}
    >
      <button
        onClick={() => setUserOpen(!open)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
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
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            inFlight ? "pulse-live" : ""
          }`}
          style={{ background: statusColor }}
        />
        <span className="text-[10px] tracking-[0.14em] uppercase font-medium flex-shrink-0"
          style={{ color: statusColor }}
        >
          {inFlight ? "turn · running" : `turn · ${turn.status}`}
        </span>
        <span className="text-[11.5px] text-fg-2 truncate flex-1 min-w-0">
          {open || !lastMsgPreview ? summary : lastMsgPreview}
        </span>
        {durationS !== null && (
          <span className="text-[10.5px] font-mono text-fg-3 flex-shrink-0">
            {durationS < 1 ? "<1s" : `${durationS.toFixed(1)}s`}
          </span>
        )}
      </button>
      {open && (
        <TurnPlanSection sessionId={sessionId} turnId={turn.turnId} />
      )}
      {open && items.length > 0 && (
        <div className="border-t border-[var(--br-1)] px-4 py-3 space-y-4">
          {items.map(({ entry, idx }) => (
            <ConversationEntryView
              key={`t-e${idx}`}
              entry={entry}
              sessionId={sessionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Live plan section for a turn. Pulls the latest plan from the
 * store (set by `agent_plan_updated` WS messages) and renders it
 * as a checklist above the turn's child items. Shows nothing if
 * the turn has no plan.
 */
function TurnPlanSection({
  sessionId,
  turnId,
}: {
  sessionId: string;
  turnId: string;
}) {
  const plan = useAppStore(
    (s) => s.planByTurn.get(sessionId)?.get(turnId),
  );
  if (!plan || plan.length === 0) return null;

  return (
    <div className="border-t border-[var(--br-1)] px-4 py-3 bg-[var(--bg)]">
      <div className="text-[10px] uppercase tracking-[0.14em] text-fg-3 font-medium mb-2">
        plan
      </div>
      <ul className="space-y-1">
        {plan.map((p, i) => {
          const isDone = p.status === "completed";
          const isActive = p.status === "in_progress";
          const dotColor = isDone
            ? "var(--ok)"
            : isActive
              ? "var(--accent)"
              : "var(--br-2)";
          return (
            <li key={i} className="flex items-start gap-2 text-[12.5px]">
              <span
                className={`mt-1.5 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isActive ? "pulse-live" : ""
                }`}
                style={{ background: dotColor }}
              />
              <span
                className={`flex-1 min-w-0 leading-relaxed ${
                  isDone
                    ? "text-fg-3 line-through"
                    : isActive
                      ? "text-fg-1"
                      : "text-fg-2"
                }`}
              >
                {p.step}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Memoized so that when a streaming delta updates one entry, the
// other (unchanged) entries don't re-render. Default shallow prop
// comparison is correct here — `entry` is a stable reference for
// unchanged entries, and `sessionId` is a string.
const ConversationEntryView = memo(function ConversationEntryView({
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
    // Short status messages render as one-liners; multi-line system
    // entries (e.g. /diff output) render markdown so code blocks work.
    const isMultiline = entry.text.includes("\n");
    if (!isMultiline) {
      return (
        <div className="text-[10.5px] text-fg-3 italic">{entry.text}</div>
      );
    }
    return (
      <div className="text-[12px] text-fg-2 border-l-2 border-[var(--br-2)] pl-3">
        <Markdown>{entry.text}</Markdown>
      </div>
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
  if (entry.kind === "pr_draft") {
    return <InlinePrDraft pr={entry.pr} sessionId={sessionId} />;
  }
  if (entry.kind === "scaffold_proposal") {
    return (
      <InlineScaffoldProposal
        proposal={entry.proposal}
        editedYaml={entry.editedYaml}
        status={entry.status}
        errorMessage={entry.errorMessage}
        sessionId={sessionId}
      />
    );
  }
  if (entry.kind === "wire_proposal") {
    return (
      <InlineWireProposal
        proposal={entry.proposal}
        status={entry.status}
        errorMessage={entry.errorMessage}
        sessionId={sessionId}
      />
    );
  }
  if (entry.kind === "turn") {
    // Turn markers are consumed by ConversationTimeline's grouping;
    // they shouldn't reach here. Render nothing if one slips through.
    return null;
  }
  return <AgentItemView item={entry.item} />;
});

function InlinePrDraft({
  pr,
  sessionId,
}: {
  pr: import("../lib/store").PrDraftEntryState;
  sessionId: string;
}) {
  const [title, setTitle] = useState(pr.initialTitle);
  const [body, setBody] = useState(pr.initialBody);
  const updatePrDraft = useAppStore((s) => s.updatePrDraft);

  const isOpened = pr.status === "opened";
  const isOpening = pr.status === "opening";
  const isDiscarded = pr.status === "discarded";

  const openPr = async () => {
    updatePrDraft(sessionId, pr.draftId, { status: "opening", error: undefined });
    try {
      const res = await api.openPr(sessionId, { title, body });
      updatePrDraft(sessionId, pr.draftId, {
        status: "opened",
        url: res.url,
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      updatePrDraft(sessionId, pr.draftId, {
        status: "error",
        error: msg,
      });
    }
  };

  return (
    <div className="flex gap-3">
      <AgentBadge label="PR" tone="warn" />
      <div className="flex-1 min-w-0">
        <div className="border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)] overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--br-1)]">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--warn)] font-medium">
              draft pr
            </span>
            <span className="text-[10.5px] text-fg-3 font-mono">
              {pr.commitCount} commit{pr.commitCount === 1 ? "" : "s"} · base{" "}
              {pr.base.replace(/^origin\//, "")}
            </span>
          </div>
          {isDiscarded ? (
            <div className="px-3 py-2 text-[11.5px] text-fg-3 italic">
              discarded.
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-[var(--br-1)]">
                <input
                  type="text"
                  value={title}
                  disabled={isOpened || isOpening}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-transparent outline-none text-[14px] font-medium text-fg disabled:opacity-70"
                  placeholder="PR title"
                />
              </div>
              <textarea
                value={body}
                disabled={isOpened || isOpening}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                spellCheck={false}
                className="w-full bg-transparent outline-none resize-y font-mono text-[12px] text-fg-1 leading-relaxed px-3 py-2 disabled:opacity-70"
              />
              <div className="px-3 py-2 border-t border-[var(--br-1)] flex items-center gap-1.5 bg-[var(--bg)]">
                {isOpened ? (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11.5px] text-[var(--accent)] hover:underline font-mono break-all"
                  >
                    opened · {pr.url}
                  </a>
                ) : (
                  <>
                    <button
                      onClick={openPr}
                      disabled={isOpening}
                      className="text-[11.5px] font-medium text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded transition"
                    >
                      {isOpening ? "opening…" : "push + open PR"}
                    </button>
                    <button
                      onClick={() =>
                        updatePrDraft(sessionId, pr.draftId, {
                          status: "discarded",
                        })
                      }
                      className="text-[11.5px] text-fg-3 hover:text-fg-1 px-2 py-1.5 rounded transition"
                    >
                      discard
                    </button>
                  </>
                )}
              </div>
              {pr.error && (
                <div className="px-3 py-2 text-[11px] text-[var(--err)] border-t border-[var(--br-1)] break-words">
                  {pr.error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineScaffoldProposal({
  proposal,
  editedYaml,
  status,
  errorMessage,
  sessionId,
}: {
  proposal: import("@shared/protocol").ScaffoldProposal;
  editedYaml: string | null;
  status: import("../lib/store").ScaffoldEntryStatus;
  errorMessage: string | null;
  sessionId: string;
}) {
  const [yamlDraft, setYamlDraft] = useState(editedYaml ?? proposal.yamlText);
  const [shimDraft, setShimDraft] = useState(proposal.shim?.content ?? "");
  // Which file is the user currently editing (vs previewing)? Default
  // to preview-mode for both.
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(
    "range.yaml",
  );
  const [busy, setBusy] = useState(false);
  const updateScaffold = useAppStore((s) => s.updateScaffoldEntry);

  const isAccepted = status === "accepted";
  const isDismissed = status === "dismissed";
  const isResolved = isAccepted || isDismissed;

  const accept = async () => {
    setBusy(true);
    try {
      const shimPayload = proposal.shim
        ? { path: proposal.shim.path, content: shimDraft }
        : null;
      const res = await api.acceptScaffold(
        sessionId,
        proposal.proposalId,
        yamlDraft,
        shimPayload,
      );
      if (res.error) {
        // Partial write — yaml landed but shim didn't, or vice versa.
        updateScaffold(sessionId, proposal.proposalId, {
          status: "error",
          errorMessage: res.error,
        });
      } else {
        updateScaffold(sessionId, proposal.proposalId, {
          status: "accepted",
          editedYaml: yamlDraft !== proposal.yamlText ? yamlDraft : null,
        });
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      updateScaffold(sessionId, proposal.proposalId, {
        status: "error",
        errorMessage: msg,
      });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await api.dismissScaffold(sessionId, proposal.proposalId);
      updateScaffold(sessionId, proposal.proposalId, { status: "dismissed" });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      updateScaffold(sessionId, proposal.proposalId, {
        status: "error",
        errorMessage: msg,
      });
    } finally {
      setBusy(false);
    }
  };

  const { commands, scenarios, rewardFunctions } = proposal.summary;

  // Files in the proposal — yaml is always present, shim is optional.
  type ProposedFile = {
    path: string;
    label: string;
    content: string;
    setContent: (s: string) => void;
    description?: string;
  };
  const files: ProposedFile[] = [
    {
      path: "range.yaml",
      label: "range.yaml",
      content: yamlDraft,
      setContent: setYamlDraft,
      description: "Profile — commands, scenarios, reward functions, checkpoints",
    },
  ];
  if (proposal.shim) {
    files.push({
      path: proposal.shim.path,
      label: proposal.shim.path,
      content: shimDraft,
      setContent: setShimDraft,
      description: proposal.shim.description,
    });
  }

  const acceptLabel = busy
    ? "writing…"
    : files.length === 1
      ? "accept · write range.yaml"
      : `accept · write ${files.length} files`;

  return (
    <div className="flex gap-3">
      <AgentBadge label="yml" tone="tool" />
      <div className="flex-1 min-w-0">
        <div className="border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)] overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--br-1)]">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--accent)] font-medium">
              scaffold proposal
            </span>
            <span className="text-[10.5px] text-fg-3">
              {proposal.stackLabel}
            </span>
            <span className="text-[10.5px] text-fg-3 font-mono">
              · {commands} cmd · {scenarios} scn · {rewardFunctions} reward fn
              {proposal.shim ? " · +shim" : ""}
            </span>
            {isAccepted && (
              <span className="ml-auto text-[10.5px] text-[var(--ok)] font-mono">
                accepted ✓
              </span>
            )}
            {isDismissed && (
              <span className="ml-auto text-[10.5px] text-fg-3 italic">
                dismissed
              </span>
            )}
          </div>

          {proposal.notes.length > 0 && !isResolved && (
            <ul className="px-3 py-2 border-b border-[var(--br-1)] text-[11.5px] text-fg-2 space-y-1">
              {proposal.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-fg-3">·</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {!isResolved &&
            files.map((f) => {
              const isExpanded = expandedPath === f.path;
              const isEditing = editingPath === f.path;
              return (
                <div
                  key={f.path}
                  className="border-b border-[var(--br-1)] last:border-b-0"
                >
                  <button
                    onClick={() =>
                      setExpandedPath(isExpanded ? null : f.path)
                    }
                    className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-2)] transition"
                  >
                    <span className="text-fg-3 text-[10.5px]">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                    <span className="font-mono text-[11.5px] text-fg-1 flex-1 truncate">
                      {f.label}
                    </span>
                    {f.description && (
                      <span className="text-[10.5px] text-fg-3 truncate max-w-[60%]">
                        {f.description}
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-2">
                      {isEditing ? (
                        <textarea
                          value={f.content}
                          onChange={(e) => f.setContent(e.target.value)}
                          rows={18}
                          spellCheck={false}
                          className="w-full bg-[var(--bg)] outline-none resize-y font-mono text-[12px] text-fg-1 leading-relaxed p-2 rounded border border-[var(--br-1)]"
                        />
                      ) : (
                        <pre className="font-mono text-[11.5px] text-fg-1 leading-relaxed bg-[var(--bg)] border border-[var(--br-1)] rounded p-2 max-h-72 overflow-auto whitespace-pre">
                          {f.content}
                        </pre>
                      )}
                      <div className="mt-1.5 flex justify-end">
                        <button
                          onClick={() =>
                            setEditingPath(isEditing ? null : f.path)
                          }
                          disabled={busy}
                          className="text-[10.5px] text-fg-2 hover:text-fg-1 px-2 py-0.5 rounded transition"
                        >
                          {isEditing ? "preview" : "edit"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          {!isResolved && (
            <div className="px-3 py-2 border-t border-[var(--br-1)] flex items-center gap-1.5 bg-[var(--bg)]">
              <button
                onClick={accept}
                disabled={busy}
                className="text-[11.5px] font-medium text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded transition"
              >
                {acceptLabel}
              </button>
              <button
                onClick={dismiss}
                disabled={busy}
                className="text-[11.5px] text-fg-3 hover:text-fg-1 px-2 py-1.5 rounded transition ml-auto"
              >
                dismiss
              </button>
            </div>
          )}

          {isAccepted && (
            <div className="px-3 py-2 text-[11.5px] text-fg-3 italic">
              {proposal.shim
                ? `range.yaml and ${proposal.shim.path} written. Scenarios + commands available in the slash picker.`
                : "range.yaml written. Scenarios + commands are now available in the slash picker."}
            </div>
          )}

          {errorMessage && (
            <div className="px-3 py-2 text-[11px] text-[var(--err)] border-t border-[var(--br-1)] break-words">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineWireProposal({
  proposal,
  status,
  errorMessage,
  sessionId,
}: {
  proposal: import("@shared/protocol").WireProposal;
  status: import("../lib/store").WireEntryStatus;
  errorMessage: string | null;
  sessionId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const updateWire = useAppStore((s) => s.updateWireEntry);
  const isAccepted = status === "accepted";
  const isDismissed = status === "dismissed";
  const isResolved = isAccepted || isDismissed;

  const accept = async () => {
    setBusy(true);
    try {
      await api.acceptWire(
        sessionId,
        proposal.proposalId,
        proposal.patches,
      );
      updateWire(sessionId, proposal.proposalId, { status: "accepted" });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      updateWire(sessionId, proposal.proposalId, {
        status: "error",
        errorMessage: msg,
      });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await api.dismissWire(sessionId, proposal.proposalId);
      updateWire(sessionId, proposal.proposalId, { status: "dismissed" });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      updateWire(sessionId, proposal.proposalId, {
        status: "error",
        errorMessage: msg,
      });
    } finally {
      setBusy(false);
    }
  };

  const fileCount = proposal.patches.length;
  const totalChanges = proposal.patches.reduce(
    (n, p) => n + p.changes.length,
    0,
  );

  return (
    <div className="flex gap-3">
      <AgentBadge label="wire" tone="tool" />
      <div className="flex-1 min-w-0">
        <div className="border border-[var(--br-2)] rounded-lg bg-[var(--bg-1)] overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--br-1)]">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--accent)] font-medium">
              wire proposal
            </span>
            <span className="text-[10.5px] text-fg-3">
              {proposal.kind === "wandb-hydra" ? "Hydra ↔ W&B" : proposal.kind}
            </span>
            <span className="text-[10.5px] text-fg-3 font-mono">
              · {fileCount} file{fileCount === 1 ? "" : "s"} · {totalChanges} change{totalChanges === 1 ? "" : "s"}
            </span>
            {isAccepted && (
              <span className="ml-auto text-[10.5px] text-[var(--ok)] font-mono">
                applied ✓
              </span>
            )}
            {isDismissed && (
              <span className="ml-auto text-[10.5px] text-fg-3 italic">
                dismissed
              </span>
            )}
          </div>

          {proposal.notes.length > 0 && !isResolved && (
            <ul className="px-3 py-2 border-b border-[var(--br-1)] text-[11.5px] text-fg-2 space-y-1">
              {proposal.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-fg-3">·</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {!isResolved &&
            proposal.patches.map((p) => (
              <div
                key={p.path}
                className="border-b border-[var(--br-1)] last:border-b-0"
              >
                <button
                  onClick={() =>
                    setExpandedPath(expandedPath === p.path ? null : p.path)
                  }
                  className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-2)] transition"
                >
                  <span className="text-fg-3 text-[10.5px]">
                    {expandedPath === p.path ? "▾" : "▸"}
                  </span>
                  <span className="font-mono text-[11.5px] text-fg-1 flex-1 truncate">
                    {p.path}
                  </span>
                  <span className="text-[10.5px] text-fg-3 font-mono">
                    {p.changes.length} change{p.changes.length === 1 ? "" : "s"}
                  </span>
                </button>
                {expandedPath === p.path && (
                  <div className="px-3 pb-3">
                    <ul className="text-[11.5px] text-fg-2 space-y-1 mb-2">
                      {p.changes.map((c, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-fg-3">·</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                    <pre className="font-mono text-[11px] text-fg-1 leading-relaxed bg-[var(--bg)] border border-[var(--br-1)] rounded p-2 max-h-72 overflow-auto whitespace-pre">
                      {p.newText}
                    </pre>
                  </div>
                )}
              </div>
            ))}

          {!isResolved && (
            <div className="px-3 py-2 border-t border-[var(--br-1)] flex items-center gap-1.5 bg-[var(--bg)]">
              <button
                onClick={accept}
                disabled={busy}
                className="text-[11.5px] font-medium text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded transition"
              >
                {busy ? "writing…" : `accept · write ${fileCount} file${fileCount === 1 ? "" : "s"}`}
              </button>
              <button
                onClick={dismiss}
                disabled={busy}
                className="text-[11.5px] text-fg-3 hover:text-fg-1 px-2 py-1.5 rounded transition ml-auto"
              >
                dismiss
              </button>
            </div>
          )}

          {isAccepted && (
            <div className="px-3 py-2 text-[11.5px] text-fg-3 italic">
              Patches applied. Hydra-launched W&B should no longer hang and
              configs will serialize correctly.
            </div>
          )}

          {errorMessage && (
            <div className="px-3 py-2 text-[11px] text-[var(--err)] border-t border-[var(--br-1)] break-words">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  const upsertSession = useAppStore((s) => s.upsertSession);
  const binary =
    approval.kind === "command"
      ? approvalBinary(approval.payload.command)
      : null;

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

  const allowAndAccept = async () => {
    if (approval.decision || !binary) return;
    try {
      const res = await api.allowCommand(sessionId, binary);
      upsertSession(res.session);
    } catch (e) {
      console.error("allowCommand failed", e);
    }
    decide("accept");
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
              {binary && (
                <button
                  onClick={allowAndAccept}
                  title={`auto-accept every future "${binary}" command in this session`}
                  className="text-[11px] text-[var(--accent)] border border-[var(--accent)]/60 hover:bg-[var(--accent-soft)] px-2.5 py-1 rounded transition font-medium"
                >
                  always allow <span className="font-mono">{binary}</span>
                </button>
              )}
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

/** Mirror of server/codex.ts `approvalBinary`. Pulls the user-meaningful
 *  binary name out of a Codex command payload so the UI can offer
 *  "always allow `<binary>`". */
function approvalBinary(
  command: string | string[] | undefined,
): string | null {
  if (!command) return null;
  const joined = Array.isArray(command) ? command.join(" ") : command;
  const wrapped = joined.match(
    /^\/bin\/(?:ba|z)sh\s+-l?c\s+(['"])(.*)\1\s*$/s,
  );
  const inner = wrapped ? wrapped[2]! : joined;
  const first = inner.trim().split(/\s+/, 1)[0] ?? "";
  if (!first) return null;
  if (first.includes("=")) {
    for (const t of inner.trim().split(/\s+/)) {
      if (!t.includes("=")) return t.split("/").pop() ?? t;
    }
    return null;
  }
  return first.split("/").pop() ?? first;
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

// Memoized: only the streaming item's reference changes during a
// delta. The other items in the same turn keep their identity and
// skip re-render thanks to React.memo's shallow comparison.
const AgentItemView = memo(function AgentItemView({ item }: { item: AgentItem }) {
  const inProgress = item.state === "started";
  switch (item.kind) {
    case "message":
      return (
        <div className="flex gap-3">
          <AgentBadge label="cdx" />
          <div className="flex-1 min-w-0 text-[13.5px] text-fg-1 break-words">
            {item.text ? (
              // Defer Markdown parsing until the message finishes streaming.
              // ReactMarkdown re-parses the full AST on every delta otherwise;
              // for a long assistant message that's dozens of unnecessary
              // parses. Plain text mid-stream, Markdown on completion.
              inProgress ? (
                <span className="whitespace-pre-wrap">{item.text}</span>
              ) : (
                <Markdown>{item.text}</Markdown>
              )
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
      return <ReasoningItemView item={item} inProgress={inProgress} />;
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
});

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

function ReasoningItemView({
  item,
  inProgress,
}: {
  item: Extract<AgentItem, { kind: "reasoning" }>;
  inProgress: boolean;
}) {
  // Track when this reasoning item first appeared so we can show
  // "Thought for Xs" once it completes. We don't get this from the
  // protocol; we just timestamp the first render.
  const startedAt = useRef<number | null>(null);
  if (startedAt.current === null) startedAt.current = Date.now();
  const completedAt = useRef<number | null>(null);
  if (!inProgress && completedAt.current === null) {
    completedAt.current = Date.now();
  }
  const [open, setOpen] = useState(false);

  const durationS =
    completedAt.current !== null && startedAt.current !== null
      ? Math.max(0, (completedAt.current - startedAt.current) / 1000)
      : null;

  const header = inProgress
    ? "thinking…"
    : durationS !== null
      ? `Thought for ${durationS < 1 ? "<1s" : `${durationS.toFixed(0)}s`}`
      : "Thought";

  return (
    <div className="flex gap-3">
      <AgentBadge label="·" />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={!item.text}
          className="flex items-center gap-1.5 text-[12px] text-fg-3 italic hover:text-fg-2 transition disabled:cursor-default"
        >
          {item.text && (
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
          )}
          <span className={inProgress ? "pulse-live" : ""}>{header}</span>
        </button>
        {open && item.text && (
          <div className="mt-1 text-[12px] text-fg-3 italic border-l-2 border-[var(--br-1)] pl-3">
            {inProgress ? (
              <span className="whitespace-pre-wrap">{item.text}</span>
            ) : (
              <Markdown>{item.text}</Markdown>
            )}
          </div>
        )}
      </div>
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
  // Per-backend native commands. Fetched once on mount; refetch if
  // the active backend changes (rare). Empty by default so the
  // picker doesn't block waiting for the network round-trip.
  const [nativeCommands, setNativeCommands] = useState<
    Array<{ name: string; description: string; argHint?: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    api
      .listBackendCommands(session.id)
      .then((res) => {
        if (!cancelled) setNativeCommands(res.commands);
      })
      .catch((err) =>
        console.error("listBackendCommands failed", err),
      );
    return () => {
      cancelled = true;
    };
  }, [session.id, session.backend]);
  const pushUserMessage = useAppStore((s) => s.pushUserMessage);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const patch = useAppStore((s) => s.patchConversation);
  const profile = useAppStore((s) =>
    s.profilesBySession.get(session.id),
  );

  // Slash-command items (scenarios + commands from range.yaml + builtins).
  type SlashItem =
    | {
        kind: "scenario";
        layer: "scenario";
        name: string;
        description?: string;
        sweepCount: number;
      }
    | {
        kind: "command";
        layer: "command";
        name: string;
        description?: string;
        args: string[];
      }
    | {
        kind: "builtin";
        layer: "range" | "codex";
        name: string;
        description: string;
        argHint?: string;
      }
    | {
        kind: "agent_native";
        layer: "opencode";
        name: string;
        description: string;
        argHint?: string;
      };
  const allItems: SlashItem[] = (() => {
    const items: SlashItem[] = [];

    // Range builtins (operate on the harness).
    items.push({
      kind: "builtin",
      layer: "range",
      name: "pr",
      description: "draft a pull request from the current branch",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "restart",
      description: "kill Codex and start a fresh thread with current settings",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "clear",
      description: "archive history + restart Codex + clear chat (keeps runs)",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "investigate",
      description:
        "kick off a NaN / instability investigation on the latest failed run",
      argHint: "[run-id]  (defaults to latest failed)",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "transcript",
      description:
        "download this session's conversation as a markdown file (useful for blog/post writeups)",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "wire",
      description:
        "patch a known-fragile integration (currently: Hydra + W&B)",
      argHint: "wandb-hydra",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "eval",
      description:
        "re-run a scenario with RANGE_CHECKPOINT set (loads a frozen policy instead of training)",
      argHint: "<checkpoint-path> [scenario]",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "reward",
      description:
        "show the source of a declared reward function inline",
      argHint: "show <reward-name>",
    });
    items.push({
      kind: "builtin",
      layer: "range",
      name: "obs",
      description:
        "show the observation vector at a specific tick of a run",
      argHint: "<run-id> <step>",
    });

    // Agent-layer builtins. Some are Codex-specific (model/think/
    // approvals depend on Codex's thread/start params); the rest are
    // universal (compact, tokens, diff, sandbox via permission
    // ruleset). For OpenCode sessions we hide the Codex-only ones.
    const isCodex = session.backend === "codex";
    // /model works on both backends but accepts different shapes:
    //   Codex:    /model <model>            (e.g., gpt-5)
    //   OpenCode: /model <provider>/<model> (e.g., nvidia-inference-gateway/openai/openai/gpt-5.5)
    // The first `/` separates provider from model id on OpenCode.
    const modelCurrent = isCodex
      ? session.model ?? "default"
      : session.modelProvider && session.model
        ? `${session.modelProvider}/${session.model}`
        : "default";
    items.push({
      kind: "builtin",
      layer: "codex",
      name: "model",
      description: `switch the LLM (current: ${modelCurrent})`,
      argHint: isCodex
        ? "<name>  e.g. gpt-5, claude-sonnet-4.5"
        : "<provider>/<model>  e.g. nvidia-inference-gateway/openai/openai/gpt-5.5",
    });
    if (isCodex) {
      items.push({
        kind: "builtin",
        layer: "codex",
        name: "think",
        description: `set reasoning effort (current: ${session.reasoningEffort ?? "default"})`,
        argHint: "low | medium | high",
      });
      items.push({
        kind: "builtin",
        layer: "codex",
        name: "approvals",
        description: `toggle auto-approve (current: ${session.autoApprove ? "on" : "off"})`,
        argHint: "on | off",
      });
    }
    items.push({
      kind: "builtin",
      layer: "codex",
      name: "sandbox",
      description: `change sandbox (current: ${session.sandbox})`,
      argHint: "read-only | workspace-write | danger-full-access",
    });
    items.push({
      kind: "builtin",
      layer: "codex",
      name: "compact",
      description: "summarize earlier turns and continue (saves context tokens)",
    });
    if (isCodex) {
      items.push({
        kind: "builtin",
        layer: "codex",
        name: "tokens",
        description: "show current thread token usage",
      });
    }
    items.push({
      kind: "builtin",
      layer: "codex",
      name: "diff",
      description: "show the current turn's aggregated unified diff",
    });

    // Backend-native commands. The list is fetched from the active
    // backend on mount — the layer matches the backend name so the
    // badge shows e.g. "opencode" in its own color.
    if (session.backend === "opencode") {
      for (const c of nativeCommands) {
        items.push({
          kind: "agent_native",
          layer: "opencode",
          name: c.name,
          description: c.description,
          argHint: c.argHint,
        });
      }
    }

    const p = profile?.profile;
    if (p) {
      for (const s of p.scenarios) {
        const sweepCount = s.sweep
          ? Object.values(s.sweep.params).reduce((a, v) => a * v.length, 1)
          : 1;
        items.push({
          kind: "scenario",
          layer: "scenario",
          name: s.name,
          description: s.description,
          sweepCount,
        });
      }
      for (const c of p.commands) {
        items.push({
          kind: "command",
          layer: "command",
          name: c.name,
          description: c.description,
          args: c.args,
        });
      }
    }
    return items;
  })();

  const slashOpen = text.startsWith("/");
  // Split "/cmd args…" into ("cmd", "args…") so users can type
  // "/model gpt-5" and still have the picker match "model".
  const slashRaw = slashOpen ? text.slice(1) : "";
  const slashFirstSpace = slashRaw.indexOf(" ");
  const slashName =
    slashFirstSpace >= 0 ? slashRaw.slice(0, slashFirstSpace) : slashRaw;
  const slashArgs =
    slashFirstSpace >= 0 ? slashRaw.slice(slashFirstSpace + 1).trim() : "";
  const matched = slashOpen
    ? allItems.filter((it) =>
        slashName === ""
          ? true
          : it.name.toLowerCase().includes(slashName.toLowerCase()),
      )
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

  const pushPrDraft = useAppStore((s) => s.pushPrDraft);
  const clearConversation = useAppStore((s) => s.clearConversation);
  const pushSystem = useAppStore((s) => s.pushSystemEntry);

  const runSlash = async (item: SlashItem) => {
    if (busy) return;
    setBusy(true);
    setSlashErr(null);
    try {
      if (item.kind === "scenario") {
        await api.runScenario(session.id, item.name);
      } else if (item.kind === "command") {
        await api.createRun(session.id, {
          command: item.args,
          kind: "shell",
        });
      } else if (item.kind === "agent_native") {
        // Native command from the active backend. We proxy to the
        // backend's runNativeCommand via the REST endpoint; the
        // result may include a human-readable message we surface
        // as a system entry.
        const res = await api.runBackendCommand(
          session.id,
          item.name,
          slashArgs.trim() || undefined,
        );
        if (res.message) pushSystem(session.id, res.message);
      } else if (item.kind === "builtin" && item.name === "pr") {
        const draft = await api.draftPr(session.id);
        const draftId = `pr_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        pushPrDraft(session.id, {
          draftId,
          initialTitle: draft.title,
          initialBody: draft.body,
          base: draft.base,
          commitCount: draft.commitCount,
          filesChanged: draft.filesChanged,
          status: "draft",
        });
      } else if (item.kind === "builtin" && item.name === "restart") {
        pushSystem(session.id, "Restarting Codex…");
        await api.restartAgent(session.id);
      } else if (item.kind === "builtin" && item.name === "clear") {
        await api.clearAgent(session.id);
        clearConversation(session.id);
      } else if (item.kind === "builtin" && item.name === "eval") {
        const parts = slashArgs.split(/\s+/).filter((s) => s.length > 0);
        const checkpoint = parts[0];
        const scenario = parts[1];
        if (!checkpoint) {
          throw new Error("usage: /eval <checkpoint-path> [scenario]");
        }
        pushSystem(
          session.id,
          `Eval run with RANGE_CHECKPOINT=${checkpoint}${scenario ? ` (scenario: ${scenario})` : ""}…`,
        );
        await api.evalCheckpoint(session.id, checkpoint, scenario);
      } else if (item.kind === "builtin" && item.name === "obs") {
        const parts = slashArgs.split(/\s+/).filter((s) => s.length > 0);
        const runId = parts[0];
        const step = Number(parts[1]);
        if (!runId || !Number.isFinite(step) || step < 0) {
          throw new Error("usage: /obs <run-id> <step>");
        }
        const res = await api.getObservation(runId, step);
        // Render as a markdown code block.
        const body =
          "# Observation · run `" +
          runId +
          "` · tick " +
          res.step +
          "\n\n```json\n" +
          JSON.stringify(res.observation, null, 2) +
          "\n```";
        pushSystem(session.id, body);
      } else if (item.kind === "builtin" && item.name === "reward") {
        const parts = slashArgs.split(/\s+/).filter((s) => s.length > 0);
        const sub = parts[0];
        const name = parts[1];
        if (sub !== "show" || !name) {
          throw new Error("usage: /reward show <reward-name>");
        }
        const r = await api.showReward(session.id, name);
        const desc = r.description ? `\n\n_${r.description}_\n` : "";
        const body =
          "# Reward · `" +
          r.name +
          "`\n\n" +
          "**File:** `" +
          r.file +
          "`  \n**Function:** `" +
          r.function +
          "`" +
          desc +
          "\n\n```python\n" +
          (r.extracted
            ? r.source
            : r.source.slice(0, 4000) +
              (r.source.length > 4000 ? "\n# … (truncated)" : "")) +
          "\n```";
        pushSystem(session.id, body);
      } else if (item.kind === "builtin" && item.name === "wire") {
        const sub = slashArgs.trim();
        if (sub !== "wandb-hydra") {
          throw new Error("usage: /wire wandb-hydra");
        }
        pushSystem(session.id, "Scanning repo for Hydra + W&B foot-guns…");
        const { proposal } = await api.previewWireWandbHydra(session.id);
        if (!proposal) {
          pushSystem(
            session.id,
            "No W&B usage detected in this repo — nothing to wire.",
          );
        }
        // If proposal is non-null, the WS broadcast already pushed the
        // card into the conversation via pushWireProposal.
      } else if (item.kind === "builtin" && item.name === "transcript") {
        const filename = slashArgs.trim() || `transcript-${session.id}.md`;
        const conv =
          useAppStore.getState().conversationsBySession.get(session.id);
        const runs =
          useAppStore.getState().runsBySession.get(session.id) ?? new Map();
        const md = renderConversationAsMarkdown({
          session,
          entries: conv?.entries ?? [],
          runs,
        });
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        pushSystem(session.id, `Downloaded \`${filename}\` (${md.length} chars).`);
      } else if (item.kind === "builtin" && item.name === "investigate") {
        // Pick the target run: explicit arg, else the most-recent failed
        // run for this session.
        let targetRunId = slashArgs.trim() || null;
        if (!targetRunId) {
          const runs = useAppStore
            .getState()
            .runsBySession.get(session.id);
          if (runs) {
            const failed = [...runs.values()]
              .filter((r) => r.state === "failed")
              .sort((a, b) => b.createdAt - a.createdAt);
            targetRunId = failed[0]?.id ?? null;
          }
        }
        if (!targetRunId) {
          throw new Error(
            "no failed run found in this session — pass a run id explicitly: /investigate <run-id>",
          );
        }
        pushSystem(session.id, `Inspecting trajectory for ${targetRunId}…`);
        const { report, promptBlock } = await api.inspectTrajectory(targetRunId);
        if (!report.firstHit) {
          pushSystem(
            session.id,
            `Trajectory is clean — no NaN/Inf detected in ${report.totalTicks} ticks. Nothing to investigate.`,
          );
        } else {
          const prompt =
            promptBlock +
            "\n\n" +
            "Investigate this. Steps:\n" +
            "1. Identify which code path is responsible for the contaminated " +
            "field(s). Look at the source files that produce these values.\n" +
            "2. Bisect: try running the same scenario with the env var " +
            "`YARD_BUG_*` toggled off to confirm the bug is the cause.\n" +
            "3. Propose a fix as a code edit. Keep it minimal — the bug is " +
            "behind a guard; remove the guard or fix the underlying logic.\n" +
            "Use `range trajectory inspect <run-id>` for follow-up runs.";
          await api.sendAgentMessage(session.id, prompt);
        }
      } else if (item.kind === "builtin" && item.name === "model") {
        const raw = slashArgs.trim();
        if (!raw) {
          throw new Error(
            session.backend === "opencode"
              ? "usage: /model <provider>/<model>"
              : "usage: /model <name>",
          );
        }
        let model: string;
        let provider: string | null = null;
        if (session.backend === "opencode") {
          // First "/" separates provider from model id. The model id
          // itself can contain further "/"-separated components
          // (e.g. nvidia-inference-gateway/openai/openai/gpt-5.5).
          const slashIdx = raw.indexOf("/");
          if (slashIdx <= 0) {
            throw new Error(
              "OpenCode /model needs `<provider>/<model>` — got: " + raw,
            );
          }
          provider = raw.slice(0, slashIdx);
          model = raw.slice(slashIdx + 1);
          if (!model) {
            throw new Error("model id missing after `/`");
          }
        } else {
          model = raw;
        }
        const res = await api.setModel(session.id, model, provider);
        useAppStore.getState().upsertSession(res.session);
        pushSystem(
          session.id,
          provider ? `model → ${provider}/${model}` : `model → ${model}`,
        );
      } else if (item.kind === "builtin" && item.name === "think") {
        const eff = slashArgs.toLowerCase();
        if (!["low", "medium", "high"].includes(eff)) {
          throw new Error("usage: /think low | medium | high");
        }
        const res = await api.setReasoning(
          session.id,
          eff as "low" | "medium" | "high",
        );
        useAppStore.getState().upsertSession(res.session);
        pushSystem(session.id, `reasoning → ${eff}`);
      } else if (item.kind === "builtin" && item.name === "sandbox") {
        const s = slashArgs as Sandbox;
        if (!["read-only", "workspace-write", "danger-full-access"].includes(s)) {
          throw new Error(
            "usage: /sandbox read-only | workspace-write | danger-full-access",
          );
        }
        const res = await api.setSandbox(session.id, s);
        useAppStore.getState().upsertSession(res.session);
        pushSystem(session.id, `sandbox → ${s}`);
      } else if (item.kind === "builtin" && item.name === "approvals") {
        const v = slashArgs.toLowerCase();
        if (v !== "on" && v !== "off") {
          throw new Error("usage: /approvals on | off");
        }
        const res = await api.setAutoApprove(session.id, v === "on");
        useAppStore.getState().upsertSession(res.session);
        pushSystem(session.id, `auto-approve → ${v}`);
      } else if (item.kind === "builtin" && item.name === "compact") {
        pushSystem(session.id, "Compacting conversation…");
        await api.compactAgent(session.id);
      } else if (item.kind === "builtin" && item.name === "tokens") {
        const usage = useAppStore
          .getState()
          .tokenUsageBySession.get(session.id);
        if (!usage) {
          pushSystem(
            session.id,
            "No token usage reported yet — send a turn first.",
          );
        } else {
          const ctx = usage.modelContextWindow;
          const total = usage.total.totalTokens;
          const ratio = ctx ? ` / ${ctx.toLocaleString()} (${Math.round((total / ctx) * 100)}%)` : "";
          pushSystem(
            session.id,
            `tokens · total ${total.toLocaleString()}${ratio} · ` +
              `last turn: in ${usage.last.inputTokens.toLocaleString()}, ` +
              `out ${usage.last.outputTokens.toLocaleString()}, ` +
              `reasoning ${usage.last.reasoningOutputTokens.toLocaleString()}`,
          );
        }
      } else if (item.kind === "builtin" && item.name === "diff") {
        const diff = useAppStore
          .getState()
          .lastTurnDiffBySession.get(session.id);
        if (!diff) {
          pushSystem(
            session.id,
            "No pending turn diff — Codex hasn't touched any files this turn.",
          );
        } else {
          const truncated =
            diff.length > 8000
              ? diff.slice(0, 8000) + "\n…(truncated)"
              : diff;
          pushSystem(session.id, "Pending turn diff:\n\n```diff\n" + truncated + "\n```");
        }
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
          query={slashName}
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

type SlashItem =
  | {
      kind: "scenario";
      layer: "scenario";
      name: string;
      description?: string;
      sweepCount: number;
    }
  | {
      kind: "command";
      layer: "command";
      name: string;
      description?: string;
      args: string[];
    }
  | {
      kind: "builtin";
      layer: "range" | "codex";
      name: string;
      description: string;
      argHint?: string;
    }
  | {
      kind: "agent_native";
      layer: "opencode";
      name: string;
      description: string;
      argHint?: string;
    };

const LAYER_STYLE: Record<
  SlashItem["layer"],
  { label: string; color: string; bg: string }
> = {
  range: {
    label: "range",
    color: "var(--warn)",
    bg: "color-mix(in oklch, var(--warn) 12%, var(--bg))",
  },
  codex: {
    label: "codex",
    color: "var(--accent)",
    bg: "color-mix(in oklch, var(--accent) 12%, var(--bg))",
  },
  opencode: {
    label: "opencode",
    color: "var(--ok)",
    bg: "color-mix(in oklch, var(--ok) 12%, var(--bg))",
  },
  scenario: {
    label: "scenario",
    color: "var(--accent-2)",
    bg: "color-mix(in oklch, var(--accent) 8%, var(--bg))",
  },
  command: {
    label: "command",
    color: "var(--fg-2)",
    bg: "var(--bg)",
  },
};

function SlashPicker({
  items,
  selectedIdx,
  onPick,
  query,
}: {
  items: SlashItem[];
  selectedIdx: number;
  onPick: (item: SlashItem) => void;
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
        const ls = LAYER_STYLE[it.layer];
        const glyph =
          it.kind === "scenario" ? "▶" : it.kind === "builtin" ? "✦" : "$";
        return (
          <button
            key={`${it.layer}-${it.name}`}
            onClick={() => onPick(it)}
            className={`w-full px-3 py-2 flex items-center gap-2 text-left transition ${
              isSel
                ? "bg-[var(--bg-2)] border-l-2 border-[var(--accent)]"
                : "border-l-2 border-transparent hover:bg-[var(--bg-2)]"
            }`}
          >
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em] flex-shrink-0"
              style={{ color: ls.color }}
            >
              {glyph}
            </span>
            <span className="font-mono text-[12.5px] text-fg-1 flex-shrink-0">
              {it.name}
            </span>
            {it.kind === "scenario" && it.sweepCount > 1 && (
              <span className="font-mono text-[10px] text-[var(--accent)]">
                ×{it.sweepCount}
              </span>
            )}
            {it.kind === "builtin" && it.argHint && (
              <span className="font-mono text-[10.5px] text-fg-3">
                {it.argHint}
              </span>
            )}
            <span className="text-[11px] text-fg-3 truncate flex-1 min-w-0">
              {it.description ??
                (it.kind === "command" ? it.args.join(" ") : "")}
            </span>
            <span
              className="text-[10px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border flex-shrink-0"
              style={{
                color: ls.color,
                background: ls.bg,
                borderColor: `color-mix(in oklch, ${ls.color} 30%, var(--br-1))`,
              }}
            >
              {ls.label}
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
  if (kind === "npy") {
    return <TrajectoryPreview url={url} name={name} />;
  }
  return null;
}

/**
 * NPZ trajectory viewer. On click, fetches the per-field arrays
 * from /api/runs/:id/trajectory (server-side downsampled to 2000
 * points), renders one SVG panel per 1D field, with a shared
 * scrub cursor synced across panels.
 *
 * URL shape: /api/runs/<runId>/artifacts/<name>. We extract
 * `runId` from the path because that's what the trajectory
 * endpoint keys off of.
 */
function TrajectoryPreview({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  const [data, setData] = useState<
    import("@shared/protocol").ArtifactInfo extends never
      ? never
      : Awaited<ReturnType<typeof api.getTrajectory>> | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number>(0);

  // Only support trajectory.npz for now — other .npy/.npz files
  // get a generic "binary, download to inspect" treatment.
  const isTrajectory = name === "trajectory.npz";
  if (!isTrajectory) {
    return (
      <div className="border-t border-[var(--br-1)] bg-[var(--bg)] px-3 py-2 text-[11px] text-fg-3 italic">
        binary NumPy array — preview only available for{" "}
        <span className="font-mono text-fg-2">trajectory.npz</span>.
      </div>
    );
  }

  // url: /api/runs/<runId>/artifacts/trajectory.npz
  const runIdMatch = url.match(/\/api\/runs\/([^/]+)\/artifacts\//);
  const runId = runIdMatch ? decodeURIComponent(runIdMatch[1]!) : null;

  const load = async () => {
    if (!runId) {
      setErr("could not parse run id from artifact url");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await api.getTrajectory(runId);
      setData(res);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading) {
    return (
      <div className="border-t border-[var(--br-1)] bg-[var(--bg)] px-3 py-2 flex items-center gap-2">
        <button
          onClick={load}
          className="text-[11.5px] font-medium text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] px-3 py-1 rounded transition"
        >
          📈 view trajectory
        </button>
        {err && (
          <span className="text-[11px] text-[var(--err)] italic">{err}</span>
        )}
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="border-t border-[var(--br-1)] bg-[var(--bg)] px-3 py-2 text-[11px] text-fg-3 italic">
        loading trajectory…
      </div>
    );
  }

  // Pick 1D fields, excluding `t` (used as x-axis). Sort so the
  // typical sim-RL metric set lands in a sensible order.
  const fieldNames = Object.keys(data.fields).filter((k) => {
    const f = data.fields[k]!;
    return f.shape.length === 1 && f.shape[0] > 1;
  });
  const tField = data.fields["t"];
  const N = tField
    ? tField.shape[0]
    : Math.max(...fieldNames.map((k) => data.fields[k]!.shape[0]!));
  const ts = tField?.data ?? null;

  // Sort: keep `t` for axis only, render the rest in priority order
  const priorityOrder = [
    "x",
    "y",
    "yaw",
    "speed",
    "left_v_cmd",
    "right_v_cmd",
    "ctrl_left",
    "ctrl_right",
    "min_depth",
    "collided",
  ];
  const sortedFields = fieldNames
    .filter((k) => k !== "t")
    .sort((a, b) => {
      const ai = priorityOrder.indexOf(a);
      const bi = priorityOrder.indexOf(b);
      if (ai === bi) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, x / rect.width));
    setCursor(Math.round(frac * (N - 1)));
  };

  return (
    <div className="border-t border-[var(--br-1)] bg-[var(--bg)] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fg-3 font-medium">
          trajectory · {N} {data.downsampled ? `of ${data.ticks}` : ""} ticks ·{" "}
          {sortedFields.length} fields
        </div>
        <div className="text-[10.5px] font-mono text-fg-2">
          tick {cursor}
          {ts && typeof ts[cursor] === "number"
            ? ` · t=${(ts[cursor] as number).toFixed(3)}s`
            : ""}
        </div>
      </div>
      <div
        onMouseMove={onScrub}
        className="space-y-1.5 cursor-crosshair select-none"
      >
        {sortedFields.map((k) => (
          <TrajectoryPanel
            key={k}
            name={k}
            data={data.fields[k]!.data}
            cursor={cursor}
            isBool={data.fields[k]!.dtype === "bool"}
          />
        ))}
      </div>
    </div>
  );
}

/** A single SVG panel: 480×40 typical. Renders a polyline of the
 *  field's values, with nulls (NaN) shown as gaps. A vertical
 *  cursor line marks the current scrub position. */
function TrajectoryPanel({
  name,
  data,
  cursor,
  isBool,
}: {
  name: string;
  data: (number | null)[];
  cursor: number;
  isBool: boolean;
}) {
  const W = 480;
  const H = isBool ? 14 : 36;

  const { min, max, valueAtCursor, hasNaN } = useMemo(() => {
    let mn = Infinity,
      mx = -Infinity,
      nan = false;
    for (const v of data) {
      if (v === null || !Number.isFinite(v)) {
        nan = true;
        continue;
      }
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!Number.isFinite(mn)) {
      mn = 0;
      mx = 1;
    }
    if (mn === mx) {
      mn -= 0.5;
      mx += 0.5;
    }
    return {
      min: mn,
      max: mx,
      valueAtCursor: data[cursor] ?? null,
      hasNaN: nan,
    };
  }, [data, cursor]);

  // Build the polyline path, breaking at nulls so gaps render
  // visually.
  const path = useMemo(() => {
    const segs: string[] = [];
    let pending = true;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v === null || !Number.isFinite(v)) {
        pending = true;
        continue;
      }
      const x = (i / Math.max(1, data.length - 1)) * W;
      const y = isBool
        ? v
          ? 1
          : H - 1
        : H - ((v - min) / (max - min)) * (H - 2) - 1;
      segs.push((pending ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1));
      pending = false;
    }
    return segs.join(" ");
  }, [data, min, max, H, isBool]);

  const cursorX =
    (Math.min(cursor, data.length - 1) /
      Math.max(1, data.length - 1)) *
    W;
  const stroke = hasNaN ? "var(--err)" : "var(--accent)";

  return (
    <div className="flex items-center gap-2">
      <div className="text-[10.5px] font-mono text-fg-2 w-24 flex-shrink-0 truncate">
        {name}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="flex-1 h-9 bg-[var(--bg-1)] border border-[var(--br-1)] rounded"
      >
        {isBool ? (
          <g>
            {data.map((v, i) => {
              if (v === null || !v) return null;
              const x =
                (i / Math.max(1, data.length - 1)) * W;
              return (
                <rect
                  key={i}
                  x={x}
                  y={2}
                  width={Math.max(1, W / data.length)}
                  height={H - 4}
                  fill="var(--err)"
                />
              );
            })}
          </g>
        ) : (
          <path d={path} fill="none" stroke={stroke} strokeWidth="1" />
        )}
        <line
          x1={cursorX}
          y1={0}
          x2={cursorX}
          y2={H}
          stroke="var(--fg-3)"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />
      </svg>
      <div className="text-[10.5px] font-mono text-fg-3 w-20 text-right flex-shrink-0">
        {valueAtCursor === null
          ? "NaN"
          : isBool
            ? valueAtCursor
              ? "yes"
              : "no"
            : (valueAtCursor as number).toFixed(3)}
      </div>
      <div className="text-[9.5px] font-mono text-fg-3/60 w-24 text-right flex-shrink-0">
        [{Number.isFinite(min) ? min.toFixed(2) : "?"},{" "}
        {Number.isFinite(max) ? max.toFixed(2) : "?"}]
      </div>
    </div>
  );
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s - m * 60);
  return `${m}m ${rem}s`;
}

function RunRow({ run }: { run: Run }) {
  const stateColor = runStateColor(run.state);
  const dotClass = runStateDotClass(run.state);
  const cmd = run.command.join(" ");
  const elapsed =
    run.finishedAt && run.startedAt
      ? formatDuration(run.finishedAt - run.startedAt)
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
          <span
            className="font-mono text-[11px] tabular-nums w-[70px] text-right"
            style={{
              color:
                run.state === "succeeded" || run.state === "failed"
                  ? "var(--fg-1)"
                  : "var(--fg-3)",
            }}
            title={
              run.finishedAt && run.startedAt
                ? `${run.finishedAt - run.startedAt}ms`
                : undefined
            }
          >
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
