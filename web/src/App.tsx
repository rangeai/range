import { useWsState } from "./lib/ws";

export function App() {
  const ws = useWsState();

  const status = ws.connection.phase;
  const statusLabel =
    status === "open"
      ? "connected"
      : status === "connecting"
        ? "connecting"
        : status === "reconnecting"
          ? `reconnecting · attempt ${ws.connection.attempt}`
          : "disconnected";

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl w-full">
          <div className="text-[10px] tracking-[0.18em] uppercase text-fg-3 mb-3">
            phase 1 · foundation
          </div>
          <h1 className="font-display tracking-tightest text-5xl font-light leading-tight mb-4">
            range mvp is{" "}
            <span className="italic text-fg-2">booting up.</span>
          </h1>
          <p className="text-[15px] text-fg-1 leading-relaxed max-w-xl mb-8">
            this is the scaffolded foundation: bun + hono server, react +
            vite frontend, websocket bridge between them. nothing else is
            wired up yet. attempt, run, codex adapter, evidence streaming
            all land in the next commits.
          </p>

          <div className="grid grid-cols-2 gap-3 max-w-md mb-10">
            <Stat
              label="server"
              value={ws.lastServerHello ? "range" : "—"}
              hint={
                ws.lastServerHello
                  ? `v${ws.lastServerHello.version}`
                  : "no hello yet"
              }
              live={!!ws.lastServerHello}
            />
            <Stat
              label="connection"
              value={statusLabel}
              hint={
                ws.latencyMs !== null
                  ? `${ws.latencyMs}ms`
                  : "—"
              }
              live={status === "open"}
            />
          </div>

          <div className="text-[12px] text-fg-3 font-mono">
            $ tail -f web/server/index.ts
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="h-12 border-b border-[var(--br-1)] flex items-center px-5 gap-4 bg-[var(--bg-1)]">
      <div className="flex items-center gap-2">
        <div className="fanmark"></div>
        <span className="font-display tracking-tightest text-[18px] font-light">
          range
        </span>
      </div>
      <span className="text-fg-3 text-[12px]">·</span>
      <span className="text-[12px] text-fg-2">mvp · phase 1</span>
      <div className="flex-1"></div>
      <button
        data-theme-toggle
        className="w-7 h-7 rounded border border-[var(--br-1)] hover:border-[var(--br-2)] hover:bg-[var(--bg-2)] flex items-center justify-center text-fg-2 hover:text-fg transition"
        aria-label="Toggle theme"
      >
        <svg
          className="theme-sun w-3.5 h-3.5"
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path
            d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <svg
          className="theme-moon w-3.5 h-3.5"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"
            fill="currentColor"
          />
        </svg>
      </button>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--br-1)] px-5 py-3 text-[11px] text-fg-3 flex items-center gap-3">
      <span>open source · MIT</span>
      <span>·</span>
      <span className="font-mono">localhost:3457</span>
      <div className="flex-1"></div>
      <span className="font-mono">
        {new Date().toISOString().slice(0, 10)}
      </span>
    </footer>
  );
}

function Stat({
  label,
  value,
  hint,
  live,
}: {
  label: string;
  value: string;
  hint?: string;
  live?: boolean;
}) {
  return (
    <div className="border border-[var(--br-1)] rounded-lg p-3 bg-[var(--bg-1)]">
      <div className="flex items-center gap-1.5 mb-1.5">
        {live && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] pulse-live"></span>
        )}
        <div className="text-[10px] tracking-[0.16em] uppercase text-fg-3">
          {label}
        </div>
      </div>
      <div className="font-mono text-[15px] text-fg">{value}</div>
      {hint && (
        <div className="font-mono text-[10.5px] text-fg-3 mt-0.5">
          {hint}
        </div>
      )}
    </div>
  );
}
