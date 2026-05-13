import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { sessionsByRecency, useAppStore } from "../lib/store";
import type { Session, SessionKind } from "@shared/protocol";

/**
 * Persistent left nav. Lists every session (newest first) so the user
 * can switch between them with one click. The top action goes back to
 * the home composer to start a new session.
 */
export function LeftNav() {
  const sessions = useAppStore((s) => s.sessions);
  const view = useAppStore((s) => s.view);
  const upsertManySessions = useAppStore((s) => s.upsertManySessions);
  const openSession = useAppStore((s) => s.openSession);
  const goHome = useAppStore((s) => s.goHome);

  // Pull the session list once on mount so the nav is populated even
  // before the user has navigated to home.
  useEffect(() => {
    api
      .listSessions()
      .then((res) => upsertManySessions(res.sessions))
      .catch((err) => console.error("listSessions failed", err));
  }, [upsertManySessions]);

  const ordered = sessionsByRecency(sessions);
  const currentId = view.kind === "session" ? view.id : null;

  return (
    <aside className="w-[260px] flex-shrink-0 border-r border-[var(--br-1)] bg-[var(--bg-1)] flex flex-col overflow-hidden">
      <div className="p-3 border-b border-[var(--br-1)]">
        <button
          onClick={goHome}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] transition ${
            view.kind === "home"
              ? "bg-[var(--accent)] text-[var(--bg)] font-medium"
              : "border border-[var(--br-1)] hover:border-[var(--br-2)] hover:bg-[var(--bg-2)] text-fg-1"
          }`}
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6h7M6 2.5v7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          new session
        </button>
      </div>

      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="text-[10px] tracking-[0.16em] uppercase text-fg-3 font-medium">
          sessions
        </span>
        <span className="text-[10.5px] font-mono text-fg-3">
          {ordered.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {ordered.length === 0 ? (
          <div className="px-3 py-2 text-[11.5px] text-fg-3 italic">
            none yet
          </div>
        ) : (
          ordered.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              selected={s.id === currentId}
              onClick={() => openSession(s.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  onClick,
}: {
  session: Session;
  selected: boolean;
  onClick: () => void;
}) {
  const removeSession = useAppStore((s) => s.removeSession);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const doDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await api.deleteSession(session.id);
      removeSession(session.id);
    } catch (err) {
      console.error("deleteSession failed", err);
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div
      onMouseLeave={() => setConfirming(false)}
      className={`group relative w-full flex transition ${
        selected ? "bg-[var(--bg-2)]" : "hover:bg-[var(--bg-2)]"
      }`}
    >
      <button
        onClick={onClick}
        className="flex-1 text-left px-3 py-2 flex gap-2 min-w-0"
      >
        <div
          className="w-[2px] self-stretch rounded flex-shrink-0"
          style={{
            background: selected ? "var(--accent)" : "transparent",
          }}
        ></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9.5px] tracking-[0.12em] uppercase text-fg-3">
              {labelForKind(session.kind)}
            </span>
            {session.codexThreadId && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
                title="Codex thread active"
              />
            )}
          </div>
          <div className="text-[13px] text-fg-1 truncate leading-snug pr-6">
            {session.title}
          </div>
          <div className="text-[10.5px] text-fg-3 font-mono mt-0.5">
            {formatRelativeTime(session.updatedAt)}
          </div>
        </div>
      </button>
      <button
        onClick={doDelete}
        disabled={busy}
        title={confirming ? "click again to confirm delete" : "delete session"}
        className={`absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center transition ${
          confirming
            ? "bg-[var(--err)] text-[var(--bg)] opacity-100"
            : "text-fg-3 hover:text-[var(--err)] hover:bg-[var(--bg-3)] opacity-0 group-hover:opacity-100"
        }`}
      >
        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none">
          <path
            d="M3 4h6m-5 0v5a1 1 0 001 1h2a1 1 0 001-1V4M5 2h2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

function labelForKind(kind: SessionKind): string {
  switch (kind) {
    case "tracked_task":
      return "tracked";
    case "pr_verification":
      return "pr verify";
    default:
      return "freeform";
  }
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
