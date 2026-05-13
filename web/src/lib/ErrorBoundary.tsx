import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface State {
  err: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error): State {
    return { err, info: null };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // Surface to the browser console so the user can copy-paste.
    console.error("[range] render crash:", err, info);
    this.setState({ err, info });
  }

  reset = () => {
    this.setState({ err: null, info: null });
  };

  override render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-[var(--bg)]">
        <div className="max-w-2xl w-full">
          <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--err)] mb-3">
            render crash
          </div>
          <h1 className="font-display tracking-tightest text-[28px] font-light mb-4 text-[var(--fg)]">
            Something exploded.
          </h1>
          <p className="text-[13px] text-[var(--fg-2)] leading-relaxed mb-5">
            The React tree threw during render. Range caught it so the page
            isn't blank. The full stack is in the browser console (⌥⌘I → Console).
          </p>
          <div className="border border-[var(--err)]/40 bg-[var(--err)]/10 rounded-lg p-3 mb-4">
            <div className="font-mono text-[11.5px] text-[var(--err)] break-words">
              {this.state.err.name}: {this.state.err.message}
            </div>
          </div>
          {this.state.err.stack && (
            <pre className="font-mono text-[10.5px] text-[var(--fg-3)] bg-[var(--bg-1)] border border-[var(--br-1)] rounded-lg p-3 overflow-auto max-h-[300px] whitespace-pre-wrap">
              {this.state.err.stack}
            </pre>
          )}
          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={this.reset}
              className="text-[12px] text-[var(--bg)] bg-[var(--accent)] hover:bg-[var(--accent-2)] px-3 py-1.5 rounded font-medium transition"
            >
              try again
            </button>
            <button
              onClick={() => location.reload()}
              className="text-[12px] text-[var(--fg-1)] border border-[var(--br-1)] hover:bg-[var(--bg-2)] px-3 py-1.5 rounded transition"
            >
              hard reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
