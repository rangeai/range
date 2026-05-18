import { useMemo, useState } from "react";
import * as api from "../lib/api";
import { sessionsByRecency, useAppStore } from "../lib/store";
import type {
  AgentBackendName,
  Session,
  SessionKind,
} from "@shared/protocol";

/**
 * Home is "no session selected" — just the composer. The session list
 * lives in the left nav so it's always reachable; nothing to repeat
 * here.
 */
export function Home() {
  const sessions = useAppStore((s) => s.sessions);
  return (
    <div className="min-h-full">
      <Hero sessions={sessions} />
    </div>
  );
}

function recentRepoPaths(map: Map<string, Session>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sessionsByRecency(map)) {
    if (s.repoPath && !seen.has(s.repoPath)) {
      seen.add(s.repoPath);
      out.push(s.repoPath);
    }
    if (out.length >= 5) break;
  }
  return out;
}

function Hero({ sessions }: { sessions: Map<string, Session> }) {
  const [prompt, setPrompt] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [backend, setBackend] = useState<AgentBackendName>("codex");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const openSession = useAppStore((s) => s.openSession);

  const recentRepos = useMemo(() => recentRepoPaths(sessions), [sessions]);

  const submit = async (kind: SessionKind) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createSession({
        kind,
        prompt: prompt.trim() || null,
        repoPath: repoPath.trim() || null,
        backend,
      });
      upsertSession(res.session);
      openSession(res.session.id);
      setPrompt("");
      setRepoPath("");
    } catch (err) {
      console.error("createSession failed", err);
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="relative overflow-hidden min-h-full flex flex-col">
      <div className="absolute inset-0 grid-faint opacity-50 pointer-events-none"></div>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 0%, var(--accent-soft), transparent 65%)",
        }}
      ></div>

      <div className="max-w-3xl mx-auto w-full px-6 pt-16 pb-12 relative">
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
            background:
              "linear-gradient(180deg, var(--bg-1) 0%, var(--bg) 100%)",
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

          <div className="px-5 py-3 border-t border-[var(--br-1)] flex items-center gap-2 bg-[var(--bg)]">
            <svg
              className="w-3.5 h-3.5 text-fg-3 flex-shrink-0"
              viewBox="0 0 14 14"
              fill="none"
            >
              <rect
                x="2"
                y="2"
                width="10"
                height="10"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M4 6h6M4 8h4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="repo path (optional) — /path/to/your/repo"
              disabled={busy}
              spellCheck={false}
              className="flex-1 bg-transparent outline-none text-[12.5px] font-mono text-fg-1 placeholder:text-fg-3 disabled:opacity-60"
            />
            {recentRepos.length > 0 && repoPath.length === 0 && (
              <RecentRepoMenu
                repos={recentRepos}
                onPick={(p) => setRepoPath(p)}
              />
            )}
          </div>

          <div className="px-5 py-2 border-t border-[var(--br-1)] flex items-center gap-2 bg-[var(--bg)]">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-fg-3 font-medium">
              backend
            </span>
            <BackendChip
              active={backend === "codex"}
              onClick={() => setBackend("codex")}
              disabled={busy}
              label="codex"
              hint="OpenAI · default"
            />
            <BackendChip
              active={backend === "opencode"}
              onClick={() => setBackend("opencode")}
              disabled={busy}
              label="opencode"
              hint="any provider · OSS"
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

        {error && (
          <div className="mb-4 p-3 rounded border border-[var(--err)]/40 bg-[var(--err)]/10 text-[12px] text-[var(--err)] break-words">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-fg-3 mr-1">starters:</span>
          <QuickChip onClick={() => submit("freeform")} disabled={busy}>
            freeform
          </QuickChip>
          <QuickChip onClick={() => submit("tracked_task")} disabled={busy}>
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

function RecentRepoMenu({
  repos,
  onPick,
}: {
  repos: string[];
  onPick: (p: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[10.5px] text-fg-3 hover:text-fg-1 px-2 py-1 border border-[var(--br-1)] rounded transition"
      >
        recent ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[280px] max-w-[400px] border border-[var(--br-2)] bg-[var(--bg-1)] rounded shadow-lg z-20 overflow-hidden">
          {repos.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onPick(p);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-[11.5px] font-mono text-fg-1 hover:bg-[var(--bg-2)] truncate"
              title={p}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
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

function BackendChip({
  active,
  onClick,
  disabled,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] px-2.5 py-1 rounded-md border transition disabled:opacity-60 ${
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-fg-1"
          : "border-[var(--br-1)] bg-[var(--bg-1)] text-fg-2 hover:border-[var(--br-3)] hover:bg-[var(--bg-2)]"
      }`}
      title={hint}
    >
      <span className="font-mono">{label}</span>
      <span className="ml-1.5 text-fg-3 text-[10px]">{hint}</span>
    </button>
  );
}
