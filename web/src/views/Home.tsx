import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { sessionsByRecency, useAppStore } from "../lib/store";
import type { Session, SessionKind } from "@shared/protocol";

export function Home() {
  const sessions = useAppStore((s) => s.sessions);
  const upsertMany = useAppStore((s) => s.upsertMany);
  const openSession = useAppStore((s) => s.openSession);

  useEffect(() => {
    api
      .listSessions()
      .then((res) => upsertMany(res.sessions))
      .catch((err) => console.error("listSessions failed", err));
  }, [upsertMany]);

  return (
    <div className="flex-1 overflow-y-auto">
      <Hero />
      <RecentSessions
        sessions={sessionsByRecency(sessions)}
        onOpen={openSession}
      />
    </div>
  );
}

function Hero() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const openSession = useAppStore((s) => s.openSession);

  const submit = async (kind: SessionKind) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.createSession({
        kind,
        prompt: prompt.trim() || null,
      });
      upsertSession(res.session);
      openSession(res.session.id);
      setPrompt("");
    } catch (err) {
      console.error("createSession failed", err);
      setBusy(false);
    }
  };

  return (
    <section className="relative overflow-hidden border-b border-[var(--br-1)]">
      <div className="absolute inset-0 grid-faint opacity-50"></div>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 0%, var(--accent-soft), transparent 65%)",
        }}
      ></div>

      <div className="max-w-3xl mx-auto px-6 pt-16 pb-12 relative">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-3">
          {new Date()
            .toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })
            .toLowerCase()}
        </div>

        <h1 className="font-display tracking-tightest text-[44px] leading-[1.04] font-light mb-7">
          what are we working on,{" "}
          <span className="italic text-fg-2">today?</span>
        </h1>

        <div
          className="rounded-xl overflow-hidden mb-4 border border-[var(--br-2)]"
          style={{
            background: "linear-gradient(180deg, var(--bg-1) 0%, var(--bg) 100%)",
            boxShadow:
              "0 1px 0 oklch(1 0 0 / 0.04) inset, 0 20px 60px -20px oklch(0 0 0 / 0.5), 0 0 0 1px var(--accent-soft)",
          }}
        >
          <div className="px-5 py-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              autoFocus
              rows={2}
              placeholder="pull in SIM-1842, verify a PR, debug the warehouse scenario, or just describe what you want…"
              className="w-full bg-transparent outline-none resize-none text-[16px] text-fg placeholder:text-fg-3 leading-relaxed disabled:opacity-60"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit("freeform");
                }
              }}
            />
          </div>
          <div className="px-5 py-2.5 border-t border-[var(--br-1)] flex items-center gap-3 bg-[var(--bg)]">
            <span className="text-[11px] text-fg-3">
              ⏎ to start a freeform session · or pick a kind →
            </span>
            <div className="flex-1"></div>
            <button
              onClick={() => submit("freeform")}
              disabled={busy}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] disabled:opacity-60 transition"
            >
              {busy ? "creating…" : "go"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-fg-3 mr-1">starters:</span>
          <QuickChip onClick={() => submit("freeform")} disabled={busy}>
            freeform
          </QuickChip>
          <QuickChip
            onClick={() => submit("tracked_task")}
            disabled={busy}
          >
            tracked task
          </QuickChip>
          <QuickChip
            onClick={() => submit("pr_verification")}
            disabled={busy}
          >
            verify a PR
          </QuickChip>
        </div>
      </div>
    </section>
  );
}

function QuickChip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[12px] text-fg-1 border border-[var(--br-1)] bg-[var(--bg-1)] hover:border-[var(--br-3)] hover:bg-[var(--bg-2)] disabled:opacity-60 rounded-md px-3 py-1.5 transition"
    >
      {children}
    </button>
  );
}

function RecentSessions({
  sessions,
  onOpen,
}: {
  sessions: Session[];
  onOpen: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-3">
          recent
        </div>
        <div className="text-[13px] text-fg-3 italic">
          no sessions yet. start one above.
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3">
          recent
        </div>
        <span className="text-fg-3 text-[11px] font-mono">
          {sessions.length}
        </span>
      </div>
      <div className="space-y-2">
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function SessionRow({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (id: string) => void;
}) {
  const ageLabel = formatRelativeTime(session.updatedAt);
  return (
    <button
      onClick={() => onOpen(session.id)}
      className="w-full text-left border border-[var(--br-1)] hover:border-[var(--br-2)] hover:bg-[var(--bg-2)] bg-[var(--bg-1)] rounded-lg p-4 transition"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-mono text-fg-3">
          {session.id}
        </span>
        <span className="text-fg-3 text-[10px]">·</span>
        <span className="text-[10px] font-mono text-fg-3">
          {labelForKind(session.kind)}
        </span>
      </div>
      <div className="text-[14px] text-fg leading-snug mb-1.5 truncate">
        {session.title}
      </div>
      <div className="text-[11px] text-fg-3 font-mono">
        {session.status} · {ageLabel}
      </div>
    </button>
  );
}

function labelForKind(kind: SessionKind): string {
  return kind === "tracked_task"
    ? "tracked"
    : kind === "pr_verification"
      ? "pr verify"
      : "freeform";
}

function formatRelativeTime(t: number): string {
  const diff = Date.now() - t;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
