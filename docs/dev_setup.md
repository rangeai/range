# Dev Setup — Range + Yard

**For:** Software engineers setting up Range for the first time on a Mac.
**Time:** 10–20 minutes if you don't have the prerequisites, 5 minutes if you do.

This guide assumes macOS on Apple Silicon. Linux works too with the
same tools; instructions will be ~95% identical. Windows is
unsupported.

---

## 1. Prerequisites

Install these once. Order doesn't matter.

### 1.1 Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the post-install instructions it prints (adds `brew` to your
PATH).

### 1.2 Bun

The JS runtime Range's server + tooling use. Faster than Node, has
built-in TypeScript + SQLite.

```bash
curl -fsSL https://bun.sh/install | bash
```

Verify:

```bash
bun --version    # >= 1.3 expected
```

### 1.3 uv

Python package manager (used by Yard and Playground). Drop-in
replacement for pip + venv, much faster.

```bash
brew install uv
```

Verify:

```bash
uv --version
```

### 1.4 Codex

The agent backend Range talks to. Install via npm (which comes
with Node) or use the standalone bundle.

```bash
# If you don't have node yet:
brew install node

npm install -g @openai/codex
```

Verify:

```bash
codex --version
codex app-server --help     # this is the JSON-RPC server Range spawns
```

You'll also need to authenticate with Codex — that's a one-time
`codex login` flow.

### 1.4b OpenCode (optional, for the second agent backend)

Range v0.6 supports two agent backends: **Codex** (OpenAI's CLI,
default) and **OpenCode** (open-source, provider-agnostic). Skip
this if you only plan to use Codex.

```bash
curl -fsSL https://opencode.ai/install | bash
# Or via npm:
npm install -g opencode-ai
```

Verify:

```bash
opencode --version
opencode serve --help
```

Then auth at least one provider — OpenCode supports Anthropic,
OpenAI, Google, Ollama (local), and many others:

```bash
opencode auth login
# Interactive picker; pick a provider and follow the prompts.
```

You don't need to start `opencode serve` manually — Range spawns
its own shared instance when a session uses the `opencode` backend.

**Picking a model for OpenCode sessions.** Range's default model
selector picks the first provider/model OpenCode reports, which
isn't always what you want. To pin a specific combination, set
two env vars before starting Range:

```bash
export RANGE_OPENCODE_PROVIDER=nvidia-inference-gateway
export RANGE_OPENCODE_MODEL=openai/openai/gpt-5.5
```

Anything OpenCode lists at `/config/providers` is valid. The
env-pinned combo applies to every OpenCode session.

### 1.5 git, gh (for PR drafting)

```bash
brew install git gh
gh auth login
```

`gh` is optional; Range's `/pr` builtin uses it to push + open PRs.

### 1.6 Python 3.13 (for Yard + Playground)

uv can fetch this for you on demand, so you may not need to do this
explicitly. If you want it system-wide:

```bash
brew install python@3.13
```

---

## 2. Clone the repos

```bash
mkdir -p ~/personal
cd ~/personal

# Range itself
git clone git@github.com:rangeai/range.git
# (or whatever the actual remote is — see your invite email)

# Yard — the tiny dogfood sim
git clone git@github.com:rangeai/yard.git
```

If you want Playground or Isaac Lab for testing scaffolds:

```bash
git clone --depth 1 https://github.com/google-deepmind/mujoco_playground.git ~/personal/range-fixtures/mujoco_playground
git clone --depth 1 https://github.com/isaac-sim/IsaacLab.git ~/personal/range-fixtures/IsaacLab
```

These aren't required, but they're the substrates Range's user
guide walks you through. Total disk cost: ~500 MB.

---

## 3. Install Range's deps

```bash
cd ~/personal/range/web
bun install
```

This pulls Hono, React, Zustand, etc. into `node_modules/`. Bun is
fast; should finish in under 30 seconds.

---

## 4. Install Yard's deps

```bash
cd ~/personal/yard
uv sync
```

This creates `.venv` inside Yard with Python 3.13 and pulls in
mujoco, numpy, imageio, etc. ~1 minute.

You shouldn't need to activate the venv — Yard's commands use `uv
run yard ...` which picks up the venv automatically.

Quick check:

```bash
uv run yard run --scenario warehouse_a --seed 42
```

Expect: ~5 seconds of compute, then a JSON success summary.

---

## 5. Start the dev server

```bash
cd ~/personal/range/web
bun run dev
```

This starts:

- `bun run --hot server/index.ts` on `:3457` (REST API + WebSocket)
- `vite` on `:5173` (the React frontend with hot-module-reload)

Open `http://localhost:5173/` in a browser.

You should see Range's home screen (a session list + a new-session
composer).

---

## 6. First run — sanity check

In the UI:

1. Click **New session** (or just type a prompt — that creates one).
2. Title: `setup test`. Repo path: pick `~/personal/yard`. Click create.
3. The session opens. Codex starts in the background (lazy-start —
   only spawns once you actually need it).
4. Type `/warehouse_a` and press enter.
5. A run card appears. ~5s later it finishes with `success: true`.

If you got that far, the install works.

---

## 7. Common gotchas

### "codex: command not found"

Codex isn't on your PATH. Check `which codex`. If you installed via
npm, the binary should be at `$(npm config get prefix)/bin/codex`.
Either add that to PATH or symlink the binary into `/usr/local/bin`.

### "uv sync" fails with `jaxlib` wheel error

You have Python 3.14 as your default. uv picks 3.14 by default if
it sees nothing else available. Fix:

```bash
cd ~/personal/yard
uv python pin 3.13
uv sync
```

For new Range-attached repos, the auto-scaffold emits `uv sync
--python 3.13` so this is taken care of.

### Worktree creation fails

Range creates `git worktree`s in `~/.range/worktrees/<sessionId>/`.
If your repo doesn't have any commits yet, worktree creation fails.
Make at least one commit in the repo before attaching it.

### "Port 3457 already in use"

There's a stale Range server. Kill it:

```bash
lsof -i:3457
kill <pid>
```

Or, less surgically:

```bash
pkill -f "bun.*server/index.ts"
```

### "opencode: command not found"

Same family of fix as the codex case — `~/.opencode/bin/opencode`
is the install location for the standalone installer. Add to PATH:

```bash
export PATH="$HOME/.opencode/bin:$PATH"
```

The installer usually adds this to your shell rc; you may need to
`source ~/.zshrc` in any already-open shell.

### OpenCode session sends a prompt but no response shows up

The integration spawns `opencode serve` as a subprocess and reads
its own log at `~/.range/opencode-serve.log`. Tail that file:

```bash
tail -f ~/.range/opencode-serve.log
```

If you see `AI_APICallError` or 4xx errors against a provider URL,
the provider isn't configured correctly. Run `opencode auth login`
to (re-)authenticate. The Anthropic and OpenAI flows are the most
reliable; provider-routed gateways sometimes drift.

### Many `codex app-server` processes accumulating

This was a pre-v0.5 bug. As of v0.5 Range:

- Lazy-starts Codex (no auto-spawn on session creation).
- Idle-shuts down Codex after 20 minutes of no activity.
- Reaps all Codex children on `SIGTERM` (clean dev-server shutdown).

If you have leftovers from before, kill them all:

```bash
pgrep -f "@openai/codex/.*codex app-server" | xargs kill -9
```

(The desktop `Codex.app` lives elsewhere and isn't affected.)

---

## 8. Where things live (runtime)

| path | what's there |
|---|---|
| `~/.range/range.db` | SQLite — sessions, runs, attempts |
| `~/.range/threads/<sessionId>/events.jsonl` | Per-session Codex event log (replayed on UI reload) |
| `~/.range/worktrees/<sessionId>/main/` | Git worktree Codex edits in |
| `~/.range/runs/<runId>/` | Per-run artifacts: metrics.json, events.jsonl, trajectory.npz, replay.mp4, depth_frames/ |
| `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl` | Codex's persisted thread state. Range's `thread/resume` uses these to keep conversation context across idle-shutdown. |

If something gets weird, nuking `~/.range/` (after stopping the
server) is safe — you'll lose session/run history but no source
code. Codex thread state in `~/.codex/` is independent.

---

## 9. Useful one-liners

```bash
# Tail the dev server log
tail -f /tmp/range-dev.log

# How many Codex processes are alive
ps aux | grep "codex app-server" | grep -v grep | grep -v "Codex.app" | wc -l

# Inspect a run's trajectory from the shell
bun run cli/range.ts trajectory inspect <run-id>

# List sessions
sqlite3 ~/.range/range.db "SELECT id, title FROM sessions ORDER BY created_at DESC LIMIT 10;"

# Smoke-test the scaffold detector
bun --eval 'import("./server/scaffold.ts").then(async ({ detectScaffold }) => console.log(await detectScaffold("/path/to/some/repo")))'
```

---

## 10. Next

Read the user guide: `docs/user_guide.md`. It walks through the UI
end-to-end, lists every scenario you can run, every slash command,
and the canonical investigation flows.
