# Range architecture — a 15-minute tour

This is the doc to read first if you want to contribute. By the end
you should be able to find any feature in the codebase and know
where to make a change.

## The 30-second model

Range is a **single-process Bun server** that:

1. Speaks HTTP + WebSocket to a **single-page React frontend**.
2. Spawns and supervises a long-running **agent backend**
   (Codex or OpenCode) per session, mediated through stdio or
   HTTP+SSE.
3. Spawns and supervises **scenario processes** (e.g.,
   `uv run python train.py`) as runs, streaming their stdout/stderr
   to the UI via WebSocket.
4. Persists sessions, runs, and conversation events to **SQLite +
   on-disk events.jsonl files** under `~/.range/`.

Everything is single-process MVP. There is no Redis, no replication,
no multi-tenant story yet. The simplicity is intentional — if you
need to add something fancy, ask whether the current shape can be
stretched first.

## The stack

| Layer | Choice |
|---|---|
| Runtime | [Bun](https://bun.sh) (server + bundler + package manager) |
| HTTP server | [Hono](https://hono.dev) |
| Frontend bundler | [Vite](https://vitejs.dev) |
| UI framework | React 19 |
| State | [Zustand](https://zustand-demo.pmnd.rs) — no Redux |
| Styles | [Tailwind CSS](https://tailwindcss.com) v4 |
| Database | SQLite (via Bun's built-in driver) |
| Markdown | `react-markdown` + `remark-gfm` |
| YAML parsing | `yaml` (npm package) |
| Browser automation | [Playwright](https://playwright.dev) for the demo recorder |

No build step on the server — Hono routes are read directly via
`bun run --hot`. The frontend is built by Vite. Both run side by
side in dev (server on `:3457`, frontend on `:5173`, with `/api`
and `/ws` proxied from Vite to the server).

## Repo layout

```
range/
├── README.md                       # buyer pitch
├── CONTRIBUTING.md                 # this file's parent
├── docs/
│   ├── user_guide.md               # end-to-end user doc
│   ├── dev_setup.md                # install + first-run guide
│   ├── eli5*.md                    # robotics primers
│   ├── playground_fixtures.md      # proof-harness catalog
│   ├── contributing/               # docs you're reading right now
│   └── archive/                    # superseded / historical specs
├── site/                           # Docusaurus brand + docs + blog site
│   ├── blog/                       # fixture writeups and engineering notes
│   ├── src/pages/index.tsx         # marketing landing page
│   ├── docusaurus.config.ts        # site config, theme, nav, footer
│   └── sidebars.ts                 # docs nav structure
└── web/                            # the entire app
    ├── server/                     # Hono HTTP+WS server (Bun runtime)
    ├── src/                        # React frontend (Vite)
    ├── shared/protocol.ts          # types shared server↔client
    ├── tools/demo/                 # Playwright demo recorder
    ├── tests/                      # currently sparse
    ├── package.json
    ├── tsconfig*.json              # multi-config for server + web
    └── vite.config.ts
```

## Server modules — what each file does

Everything in `web/server/`:

| Module | What it owns |
|---|---|
| `index.ts` | The Hono app — every REST route is registered here. Also the WebSocket upgrade endpoint and the hub registration. |
| `hub.ts` | In-process pub/sub for broadcasting server events to all connected WS clients. ~20 lines. |
| `sessions.ts` | Session CRUD + persistence + the lifecycle states (created, running, archived). |
| `agent.ts` | The `AgentBackend` interface — `start`, `stop`, `sendMessage`, `respondToApproval`, `compact`, `shutdownAll`, `nativeCommands`, `runNativeCommand`. Codex and OpenCode each implement it. |
| `codex.ts` | Codex backend: spawns `codex app-server`, speaks JSON-RPC over stdio, parses streaming responses into agent events. Owns lazy-start + idle-shutdown lifecycle. |
| `opencode.ts` | OpenCode backend: spawns `opencode serve`, speaks HTTP + SSE. Includes the workspace-scoped subscription and the envelope-unwrap quirks. |
| `profile.ts` | Parses `range.yaml` (commands, scenarios, reward_functions, checkpoints) into a typed `Profile`. Re-read fresh on every relevant request — no caching. |
| `scaffold.ts` | The auto-scaffolder. Three detectors run in order: Playground → Isaac Lab → generic Python. Each returns a `ScaffoldProposal` (or null). |
| `runner.ts` | Spawns scenario processes via `Bun.spawn`. Captures stdout/stderr, streams via WS as `run_log` events. Expands `${RANGE_*}` templates in args. |
| `runs.ts` | Run persistence + state machine (queued → starting → running → succeeded/failed). |
| `scenarios.ts` | Resolves a scenario name + sweep variables to a concrete spawn invocation by reading the profile and applying overrides. |
| `worktree.ts` | Manages per-session `git worktree` directories under `~/.range/worktrees/<sessionId>/` so the agent can edit files in isolation from your working copy. |
| `verification.ts` | The "did the scenario succeed?" gate evaluator. Reads `verification.gates` from the profile and applies them to run metrics. |
| `wire.ts` | The `/wire wandb-hydra` integration patcher — scans a target repo for the canonical Hydra+W&B foot-guns and proposes per-file diffs. |
| `pr.ts` | The `/pr` flow — drafts a PR title + body from the current branch's commits using `gh`. |
| `trajectory.ts` | Reads run output (e.g., `events.jsonl`, `trajectory.npz`) to extract per-tick observations for `/investigate`. |
| `npz.ts` | A minimal numpy `.npz` reader implemented in pure TypeScript. Used by `trajectory.ts`. |
| `fs_browse.ts` | The folder-picker modal's backend — paginated directory listing with a small allowlist. |
| `db.ts` | SQLite schema + migrations. Sessions, runs, sweep groupings, allowed commands. |
| `log.ts` | Structured logger; namespaces (`sessions`, `runner`, `codex`, etc.) for filterable output. |

If you're adding a new feature, this is your map. New REST endpoint
→ `index.ts`. New scenario type → `scenarios.ts` + `runner.ts`. New
agent backend → implement `AgentBackend` in a new file alongside
`codex.ts`/`opencode.ts`.

## Frontend modules

Everything in `web/src/`:

| Module | What it owns |
|---|---|
| `main.tsx` | React entry point. Renders `<App />` into `#root`. |
| `App.tsx` | Top-level shell: header, left nav, main content area, WS connection. |
| `views/Home.tsx` | The "no session selected" landing — composer + repo path input. |
| `views/LeftNav.tsx` | Persistent session list + new-session button. |
| `views/SessionView.tsx` | The big one — the entire conversation timeline, slash picker, composer, run cards, scaffold proposal cards, approval cards. ~3,800 lines today. |
| `views/Markdown.tsx` | Custom react-markdown renderer with Range-specific tweaks. |
| `lib/store.ts` | The Zustand store: sessions, conversations, runs, profiles, logs. Most app state lives here. |
| `lib/api.ts` | REST client (fetch wrappers, typed). |
| `lib/ws.ts` | WebSocket client + message dispatch into the store. |
| `lib/ErrorBoundary.tsx` | App-root error boundary. |

`SessionView.tsx` is dense but reasonably linear — it's a flat
sequence of inline component definitions for each entry kind
(message, run, sweep, scaffold proposal, approval, plan, etc.).
Find the kind you care about and the renderer is nearby.

## Shared types

`web/shared/protocol.ts` is the **single source of truth** for the
types that cross the network. Server messages broadcast over WS,
REST response shapes, scaffold proposals — all defined here. If
you're adding a new event or endpoint, types go here first.

## The data flow for one scenario run

To anchor the modules concretely, here's what happens when a user
types `/cartpole_balance` in the composer:

1. `SessionView.tsx` slash picker matches `cartpole_balance` →
   calls `api.runScenario(sessionId, "cartpole_balance")`.
2. `index.ts` `POST /api/sessions/:id/scenarios/:name/run` →
   `scenarios.ts` `runScenario({sessionId, scenarioName})`.
3. `scenarios.ts` calls `profile.ts` `loadProfile(repoPath)` —
   parses `range.yaml` fresh from disk.
4. Looks up the matching scenario, builds the spawn invocation
   (args + env), creates a `Run` record in SQLite via `runs.ts`.
5. `runner.ts` `spawnRun(...)` → `Bun.spawn(args, {env, cwd})`.
   Pipes stdout/stderr through a line-buffered reader.
6. Each line becomes a `run_log` server message via `hub.ts`
   `broadcast(...)`.
7. WS clients receive `run_log` events; `ws.ts` dispatches them
   into the store; `LogPanel` re-renders the run card's output.
8. Process exits → `runner.ts` updates run state to
   `succeeded`/`failed`, broadcasts `run_finished`.

Every other flow (scaffold proposal, `/investigate`, `/wire`, etc.)
follows the same shape: HTTP endpoint → server module → state
mutation → WS broadcast → client re-render.

## Persistence

Everything Range remembers lives under `~/.range/`:

```
~/.range/
├── range.db                # SQLite: sessions, runs, sweeps, allowed_commands
├── threads/<sessionId>/    # Codex thread state + events.jsonl (per-session)
├── worktrees/<sessionId>/  # git worktree per session — Codex's sandbox
└── runs/<runId>/           # per-run output dir
    ├── metrics.json
    ├── events.jsonl
    ├── trajectory.npz      # if the scenario writes one
    ├── replay.mp4
    └── depth_frames/
```

The `runs/<runId>/` path is what Range passes to scenarios as the
`RANGE_RUN_DIR` env var.

## Conventions you'll bump into

- **No comments unless WHY is non-obvious.** Identifier names
  carry the *what*; comments justify the *why* of surprising
  choices.
- **Profile loaded fresh each request.** Don't add caching. Yes,
  there's a known client-side staleness bug ([open
  task](../../CONTRIBUTING.md#open-priorities)) but the fix is on
  the client; the server's read-fresh semantics are correct.
- **Server messages must be typed in `protocol.ts`.** If you add a
  new event kind, the union there is the canonical declaration.
- **Sessions are the umbrella; everything else hangs off them.**
  Avoid global state that isn't keyed by session id.
- **AgentBackend is the seam.** Anything backend-specific belongs
  in `codex.ts`/`opencode.ts`; common code talks to the interface.

## When in doubt

- Trace the data flow for the feature you're touching (see the
  scenario-run example above).
- Open `web/shared/protocol.ts` — if the type you need isn't
  there, you're probably about to invent one.
- Read `web/server/index.ts` end-to-end (~1,000 lines, mostly
  short route handlers). It's the most useful single file to
  internalize.
