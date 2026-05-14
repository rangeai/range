import { useWsState } from "./lib/ws";
import { useAppStore } from "./lib/store";
import { Home } from "./views/Home";
import { LeftNav } from "./views/LeftNav";
import { SessionView } from "./views/SessionView";

export function App() {
  const view = useAppStore((s) => s.view);
  const goHome = useAppStore((s) => s.goHome);
  const ws = useWsState();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        onHome={goHome}
        connection={ws.connection.phase}
        latencyMs={ws.latencyMs}
      />
      <div className="flex-1 flex overflow-hidden min-h-0">
        <LeftNav />
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {view.kind === "home" ? (
            <div className="flex-1 overflow-y-auto">
              <Home />
            </div>
          ) : (
            <SessionView sessionId={view.id} />
          )}
        </main>
      </div>
    </div>
  );
}

function Header({
  onHome,
  connection,
  latencyMs,
}: {
  onHome: () => void;
  connection: string;
  latencyMs: number | null;
}) {
  return (
    <header className="h-12 border-b border-[var(--br-1)] flex items-center px-5 gap-4 bg-[var(--bg-1)] sticky top-0 z-30">
      <button
        onClick={onHome}
        className="flex items-center gap-2 pr-4 mr-1 border-r border-[var(--br-1)] h-full"
      >
        <div className="fanmark"></div>
        <span className="font-display tracking-tightest text-[18px] font-light">
          range
        </span>
      </button>
      <span className="text-fg-3 text-[12px]">·</span>
      <span className="text-[12px] text-fg-2">mvp · phase 1</span>

      <div className="flex-1"></div>

      <div className="flex items-center gap-2 text-[11.5px] text-fg-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 border border-[var(--br-1)] rounded">
          {connection === "open" && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] pulse-live"></span>
          )}
          {connection === "open" && latencyMs !== null ? (
            <span className="font-mono">{latencyMs}ms</span>
          ) : (
            <span className="font-mono text-fg-3">{connection}</span>
          )}
        </div>

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
      </div>
    </header>
  );
}
