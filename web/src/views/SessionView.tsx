import { useEffect } from "react";
import * as api from "../lib/api";
import { useAppStore } from "../lib/store";
import type { Session } from "@shared/protocol";

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions.get(sessionId));
  const upsertSession = useAppStore((s) => s.upsertSession);
  const goHome = useAppStore((s) => s.goHome);

  useEffect(() => {
    if (!session) {
      api
        .getSession(sessionId)
        .then((res) => upsertSession(res.session))
        .catch((err) => console.error("getSession failed", err));
    }
  }, [sessionId, session, upsertSession]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-3 text-[13px]">
        loading session {sessionId}…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <button
          onClick={goHome}
          className="text-[12px] text-fg-3 hover:text-fg-1 mb-6 flex items-center gap-1"
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

        <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-2">
          session
        </div>
        <h1 className="font-display tracking-tightest text-[28px] font-light leading-tight mb-2">
          {session.title}
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-fg-3 font-mono mb-8">
          <span>{session.id}</span>
          <span>·</span>
          <span>{session.kind}</span>
          <span>·</span>
          <span>{session.status}</span>
          <span>·</span>
          <span>created {new Date(session.createdAt).toISOString()}</span>
        </div>

        <FactGrid session={session} />

        <NextStepsCallout />
      </div>
    </div>
  );
}

function FactGrid({ session }: { session: Session }) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-10">
      <Fact label="prompt" value={session.prompt || "—"} />
      <Fact label="repo" value={session.repo || "—"} />
      <Fact label="task ref" value={session.taskRef || "—"} />
      <Fact
        label="updated"
        value={new Date(session.updatedAt).toLocaleString()}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--br-1)] rounded-lg p-3 bg-[var(--bg-1)]">
      <div className="text-[10px] tracking-[0.16em] uppercase text-fg-3 mb-1.5">
        {label}
      </div>
      <div className="text-[13px] text-fg-1 break-words">{value}</div>
    </div>
  );
}

function NextStepsCallout() {
  return (
    <div className="border border-dashed border-[var(--br-1)] rounded-lg p-5 bg-[var(--bg-1)]">
      <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-2">
        next in this MVP
      </div>
      <p className="text-[13px] text-fg-2 leading-relaxed mb-3 max-w-lg">
        sessions exist. attempts, runs, codex sessions, evidence
        streaming, verification, and PR drafting come in the next
        commits. nothing in here is wired to codex yet.
      </p>
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          create attempt
        </span>
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          launch codex
        </span>
        <span className="px-2 py-1 rounded border border-[var(--br-1)] bg-[var(--bg-2)] text-fg-1 font-mono">
          run command
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
