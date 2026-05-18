# Companion learnings — what we borrow, build, and avoid

**Document type:** Working learnings doc
**Status:** v0.1 after inspecting The-Vibe-Company/companion at HEAD on 2026-05-12
**Decision context:** "go with Companion's path" for Codex integration; MIT license permits borrowing

---

## What Companion actually is

A web + mobile UI for running Claude Code and Codex sessions. MIT licensed. Stack:

- **Server:** Bun + Hono
- **Frontend:** React + Vite (TypeScript)
- **Companion bridges browser ↔ CLI** via two WebSocket endpoints:
  - `ws://localhost:3456/ws/browser/:session` (browser-facing)
  - For Claude Code: `ws://localhost:3456/ws/cli/:session` (CLI connects to server via `--sdk-url`)
  - For Codex: server spawns `codex app-server` and talks **JSON-RPC 2.0 over stdio** (newline-delimited)

It supports multi-session, tool-call approval, worktrees, container execution, Tailscale-routed remote access, noVNC remote desktop, Linear integration, PR polling, and recorded session replay. Surprisingly complete for "just a wrapper."

---

## The transport question, properly

The earlier read ("Companion uses WebSocket via `--sdk-url`") was correct for Claude Code, wrong for Codex.

| | Claude Code | Codex |
|---|---|---|
| Transport | WebSocket | stdio (default) or WebSocket (opt-in) |
| Protocol | NDJSON | JSON-RPC 2.0 newline-delimited |
| Connection direction | CLI connects to server | Server spawns and owns the process |
| Reconnect strategy | CLI has built-in WS reconnect | Server respawns; uses `thread/resume` |
| Source of truth in repo | `web/server/claude-adapter.ts` | `web/server/codex-adapter.ts` + `CODEX_MAPPING.md` |

For Range's MVP, since we're Codex-first, **the path we follow is: spawn `codex app-server` as a subprocess and talk JSON-RPC 2.0 over stdio**. The Codex WebSocket transport (`spawnCodexWs` in their `cli-launcher.ts`) is a future option, gated behind a feature flag in their code today.

This is significantly different from the original MVP plan (`codex exec --json` only). The new plan is closer to the v0.4 spec's Path B (Codex app-server).

---

## What to borrow

These are patterns and (with attribution) code-level borrowings worth lifting. MIT requires preserving copyright notice when we copy code substantively.

### Architectural patterns

1. **`IBackendAdapter` abstraction.** The browser-facing message types are backend-agnostic. Whether it's Claude Code or Codex underneath, the browser sees the same protocol. We use the same pattern for Range — even if MVP is Codex-only, the adapter interface keeps a future Claude/other agent swap clean.

2. **Codex item lifecycle mapping.** Codex sends `item/started` → `item/updated` (optional) → `item/completed` for each "thing it does" (a tool call, a file change, a reasoning block, etc.). Companion translates these to a normalized stream-event format the UI can render. We need a similar translation layer; their `CODEX_MAPPING.md` is the spec to read.

3. **Session state machine.** Their `session-state-machine.ts` defines eight phases (`starting`, `initializing`, `ready`, `streaming`, `awaiting_permission`, `compacting`, `reconnecting`, `terminated`) with validated transitions. Clean, formally specified, ~200 lines. We borrow this nearly as-is — the phases match what Range's sessions need.

4. **Stdio transport wrapper.** Their `StdioTransport` class manages reading newline-delimited JSON from stdout, writing requests, matching responses by RPC ID, applying per-method timeouts, surfacing protocol drift. We borrow the structure.

5. **Approval flow.** When Codex emits `item/commandExecution/requestApproval` or `item/fileChange/requestApproval`, the server forwards a `permission_request` to the browser; the browser's response becomes a JSON-RPC response with `{ decision: "accept" | "decline" }`. We use the same pattern for Range's guardrail approvals.

6. **Sandbox + approval policy mappings.** UI "permission mode" maps to Codex's `approvalPolicy` enum. UI "sandbox" maps to Codex's `sandbox` enum (`"read-only"`, `"workspace-write"`, `"danger-full-access"`). These mappings are stable Codex APIs we should match exactly.

7. **Initialization handshake.** `initialize` → `initialized` → `thread/start` (or `thread/resume`). Documented in their `CODEX_MAPPING.md`. We adopt this sequence verbatim.

8. **Auth token model.** Server generates a token on first start, persists to `~/.companion/auth.json`, passes via WebSocket connect query param. For Range, we'd persist at `~/.range/auth.json` but the model is identical.

9. **Worktree tracker.** Companion's `worktree-tracker.ts` keeps a mapping of session → worktree path → branch → base SHA, and arbitrates one-writer-per-worktree. Range needs exactly this; borrow the structure.

10. **Multi-session orchestrator.** Their `session-orchestrator.ts` handles spawning/respawning, broadcasting events, lifecycle. ~1000 lines. We learn the structure; we don't need to copy line-for-line.

### Code-level borrowings (with attribution)

These specific files are small, self-contained, and useful as starting points:

| File | Lines | What it does | How we borrow |
|---|---|---|---|
| `session-state-machine.ts` | 207 | Phase enum + valid transitions + transition listeners | Copy with MIT attribution; adapt phase names if needed |
| `CODEX_MAPPING.md` | ~700 | The Codex JSON-RPC contract and its translation to browser messages | Used as reference doc; we write our own that matches |
| `auth-manager.ts` | TBD | Token persistence + validation | Use as model for Range's auth |

The rest is more useful as design influence than line-by-line copy.

---

## What to build ourselves (Range's differentiation)

Companion is a *general* Codex/Claude Code orchestration UI. Range's value-add is everything that's **simulation- and verification-aware**. None of this lives in Companion.

1. **Profile system (`range.yaml`).** Companion doesn't model "this repo's reproduce command, evaluate command, artifact globs, metric thresholds." We do.

2. **Run + evidence model.** Companion shows command output line-by-line. Range needs structured runs with categorized evidence: logs, metric events (parsed from declared paths), frames, video, artifacts with checksums.

3. **Verification engine.** Companion has zero concept of "did the change pass." Range has verification records with statuses (`passed`, `passed-with-concerns`, `failed`, `overridden`), gated PR pushes, override-with-reason flow.

4. **PR drafting with structured evidence.** Companion lets agents open PRs but doesn't build a structured evidence package. Range's PR backbone (verification record + metric deltas + artifact links + reproduction command) is template-rendered from data, not just narrative.

5. **Simulation streaming model.** Frame events, metric events, state events, video segments — Companion has nothing equivalent. This is Range's hardest claim and it's all greenfield.

6. **Runner abstraction with cost gates.** Companion's container manager runs locally; Range needs local + SSH-remote with cost estimation and approval gates.

7. **Domain-aware chrome.** The Range mockups have task/attempt structure, guardrail chips, evidence panels, cross-team handoff flows. Companion's UI is a generic chat. We can't reuse their components 1:1 for our UI; we can borrow patterns and primitives.

---

## What to avoid copying

Three things in Companion that are *not* the right fit for Range:

1. **Mobile UI.** They invested in a mobile interface (the npm package has mobile views). Range's user spends hours at a desk staring at evidence panels; mobile is not a priority and shouldn't be V1 effort.

2. **Tight Linear integration.** Companion has multiple Linear-specific files (oauth, agent, project manager). Range should integrate trackers behind a generic interface; we don't want a "Linear adapter, Jira adapter, GitHub Issue adapter, each ~400 lines."

3. **The deep generic chat UI surface.** Companion's React chat components are very developed for streaming text. Range cares more about evidence-alongside-conversation than maximally polished chat. We use simpler chat chrome and put the engineering effort into the evidence panel.

---

## Stack decision implications

If we follow Companion's stack (Bun + Hono server, React frontend), we maximize copy-paste compatibility for the patterns above. Trade-offs:

| Option | Pros | Cons |
|---|---|---|
| **Bun + Hono + React** (Companion's stack) | Maximum borrowing; modern; fast | Bun is still maturing; less Python-ecosystem adjacency for sim/ML |
| **Python (FastAPI) + React** | Closer to sim/ML ecosystem; can call MuJoCo/PyTorch in the same process if useful | Less direct code reuse from Companion; we re-implement adapters in Python |
| **Node + Express/Fastify + React** | Compatible with Companion-style code; ubiquitous | Older than Bun, slightly more boilerplate |

**Recommendation:** **Bun + Hono + React, matching Companion.** Reasons:

- Their adapter code is the most directly borrowable
- The MVP doesn't need Python in-process — Yard runs as a subprocess via the runner abstraction, so it doesn't matter what language Range itself is written in
- Bun's fast startup and bundled tooling are ergonomic for a single-developer MVP
- If we later need Python in-process (e.g., for an embedded sim profile parser), we shell out

This is a reversal from the MVP spec's open question ("Python is the obvious lean"). The Companion learnings flip the calculus.

---

## Updates implied for `range_mvp_spec_v0_1.md`

1. **Architecture table:**
   - Codex adapter: replace `codex exec --json` with `codex app-server` over JSON-RPC stdio (Companion-style). `codex exec --json` retained only for non-interactive batch jobs (e.g., generating a PR summary).
   - Backend language: lock in **Bun + Hono** instead of leaving as an open question.

2. **P0 features → Codex integration:**
   - "Spawn Codex in an attempt worktree via `codex exec --json`" → "Spawn `codex app-server` per attempt; talk JSON-RPC 2.0 over stdio; manage thread lifecycle via `thread/start` and `thread/resume`."

3. **Non-goals:**
   - "Multiple Codex adapter paths (SDK, app-server) — `codex exec` only" → "Multiple Codex transports (WebSocket transport for Codex is feature-flag P1; stdio JSON-RPC only for MVP)."

4. **Decisions already made:**
   - Add: "Codex transport = `codex app-server` over JSON-RPC stdio, modeled on Companion's `codex-adapter.ts`. WebSocket transport is post-MVP."
   - Add: "Backend stack = Bun + Hono. Frontend = React + Vite + Tailwind (matching the mockup substrate)."

5. **Section 7 (Open MVP-blocking decisions):**
   - Remove "Backend language: Node vs Python." Decided.

6. **Section 5 (Phases):**
   - Phase 1 exit criteria mentions wiring up `codex exec --json` — update to wiring up the app-server stdio adapter.

7. **Section 9 (What MVP gives up vs v0.4):**
   - Update the "Adapter A, B, C model" bullet to reflect: we're using B (app-server) primarily, retaining C (`codex exec`) only for non-interactive automation.

---

## What this changes about Range's positioning

A useful framing emerges: **Range is what Companion would become if Companion had decided to be domain-specific.** Companion built the agent-orchestration substrate. Range adds the simulation-aware layers Companion explicitly doesn't have. There's no zero-sum competition; they exist at different points on the stack.

This also clarifies the moat one more notch: Companion is open source, MIT, well-built, multi-agent. Anyone could build "Range's agent layer" by forking Companion. **What they can't fork is the simulation domain knowledge, the verification + evidence model, and the muscle memory we'll develop running Yard.** That's where Range earns its keep.

---

## Action items

- [x] Update `docs/range_mvp_spec_v0_1.md` per the list above
- [ ] When we start Phase 1, fork or vendor `session-state-machine.ts` with proper MIT attribution
- [ ] When we start Phase 1, write Range's own `CODEX_MAPPING.md` matching what we actually emit on our browser protocol
- [ ] When we start Phase 1, decide on auth model — adopt Companion's token-in-file pattern or be different
- [ ] Revisit the WebSocket transport question for Codex once we have a working stdio adapter

## License hygiene

The-Vibe-Company/companion is MIT (Copyright (c) 2025 The Vibe Company). When we vendor any source file substantively (`session-state-machine.ts` etc.), preserve the copyright header and the MIT notice. Borrowing patterns and concepts requires no attribution; copying code does.
