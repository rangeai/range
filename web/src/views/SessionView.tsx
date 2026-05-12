import { useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";
import { attemptsForSession, useAppStore } from "../lib/store";
import type {
  Attempt,
  AttemptKind,
  AttemptState,
  Session,
} from "@shared/protocol";

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions.get(sessionId));
  const attempts = useAppStore((s) => attemptsForSession(s, sessionId));
  const upsertSession = useAppStore((s) => s.upsertSession);
  const upsertManyAttempts = useAppStore((s) => s.upsertManyAttempts);
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
  }, [sessionId, session, upsertSession, upsertManyAttempts]);

  // Auto-select the most recent attempt when one exists and nothing's selected
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
        selectedAttemptId={selectedAttemptId}
        onSelect={setSelectedAttemptId}
        onBack={goHome}
      />
      <main className="flex-1 overflow-y-auto">
        {selectedAttempt ? (
          <AttemptDetail attempt={selectedAttempt} />
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
  selectedAttemptId,
  onSelect,
  onBack,
}: {
  session: Session;
  attempts: Attempt[];
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
          {labelForKind(session.kind)}
        </div>
        <div className="font-mono text-[10.5px] text-fg-3 mb-2">
          {session.id}
        </div>
        <h2 className="font-display tracking-tightest text-[15px] font-light leading-snug text-fg mb-2">
          {session.title}
        </h2>
        {session.repoPath && (
          <div className="text-[10.5px] text-fg-3 font-mono break-all">
            {session.repoPath}
          </div>
        )}
        {!session.repoPath && (
          <div className="text-[10.5px] text-fg-3 italic">
            no repo attached
          </div>
        )}
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

function AttemptRow({
  attempt,
  selected,
  onClick,
}: {
  attempt: Attempt;
  selected: boolean;
  onClick: () => void;
}) {
  const accent = stateAccentClass(attempt.state);
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
          <span>{labelForAttemptKind(attempt.kind)}</span>
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

function AttemptDetail({ attempt }: { attempt: Attempt }) {
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
          accent={stateAccentColor(attempt.state)}
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
              worktree path is reserved but not yet a real git worktree —
              attach a repo to the session and recreate the attempt.
            </div>
          )}
        </div>
      ) : (
        <div className="border border-dashed border-[var(--br-1)] rounded-lg p-4 bg-[var(--bg-1)]/40 mb-8">
          <div className="text-[12px] text-fg-2 leading-relaxed">
            no worktree — this session has no <span className="font-mono">repo_path</span>.
            attach one to enable real git worktrees for new attempts.
          </div>
        </div>
      )}

      <NextSteps />
    </div>
  );
}

function NextSteps() {
  return (
    <div className="border border-dashed border-[var(--br-1)] rounded-lg p-5 bg-[var(--bg-1)]">
      <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-2">
        next in this MVP
      </div>
      <p className="text-[13px] text-fg-2 leading-relaxed mb-3 max-w-lg">
        attempts now exist with real worktrees. next: a Codex session per attempt
        (Phase 2), then the local runner streaming evidence (Phase 2), then
        verification + PR drafting.
      </p>
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          launch codex
        </span>
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          run command
        </span>
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          stream evidence
        </span>
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          verify
        </span>
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          draft PR
        </span>
      </div>
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
        each attempt is an isolated branch of work inside this session — its own
        git worktree, its own agent thread, its own evidence. create one to
        begin.
      </p>
      {!session.repoPath && (
        <div className="mt-6 text-[11.5px] text-fg-3 italic">
          (this session has no repo_path — the first attempt will be metadata-only)
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

function labelForKind(kind: Session["kind"]): string {
  return kind === "tracked_task"
    ? "tracked task"
    : kind === "pr_verification"
      ? "pr verification"
      : "freeform session";
}

function labelForAttemptKind(kind: AttemptKind): string {
  return kind;
}

function stateAccentClass(state: AttemptState): string {
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

function stateAccentColor(state: AttemptState): string | undefined {
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
