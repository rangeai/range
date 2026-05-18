# Range — MVP Specification v0.1

**Document type:** MVP scope
**Status:** Draft v0.1 — smallest credible version of Range that can drive Yard end-to-end
**Date:** 2026-05-12
**Anchor:** Every feature exists because Yard (see `yard_product_spec_v0_1.md`) needs it. Anything not strictly required to drive Yard's phases is cut or deferred.

---

## 0. The point of Range MVP

Range MVP is the cut-down version of the v0.4 spec, scoped to one thing: **drive the Priya and Anika scenarios end-to-end on Yard**. Everything else is deferred.

Three success criteria define the MVP:

1. **Yard's three phases all complete using Range** as the harness, not as an afterthought.
2. **A non-Range user** (a friend who's a robotics engineer) can run their first session within 15 minutes of opening Range.
3. **Range generates an evidence-backed PR** that the developer would actually merge with confidence — and a reviewer would accept without re-running everything.

If the MVP can't drive Yard to completion, it has failed and we redesign.

---

## 1. Architecture — minimum viable layers

Five layers, each at minimum complexity:

| Layer | MVP form | Purpose | Cut from v0.4 |
|---|---|---|---|
| **UI** | Single-page web app (React + Vite + Tailwind) served locally | Conversation, sessions, attempts, evidence panels | No multi-user, no SSO, no team policies, no mobile |
| **Orchestration** | Bun + Hono server (matching Companion's stack to maximize borrow) | Maps user intent to actions; manages sessions and attempts | No multi-tenant, no third-party API |
| **Codex adapter** | `codex app-server` subprocess + JSON-RPC 2.0 over stdio (Companion-style) | Persistent thread per attempt; structured event lifecycle (`item/started` → `item/updated` → `item/completed`); native tool-approval flow via JSON-RPC requests | No WebSocket transport (P1); `codex exec --json` retained as fallback for non-interactive batch jobs only |
| **Runner** | Local shell + SSH-backed remote | Runs commands, captures stdout/stderr/exit code, streams artifacts back | No Kubernetes, no Docker, no auto-provisioning |
| **Storage** | Local SQLite + filesystem | Sessions, attempts, runs, artifacts, verification records | No cloud storage, no signed URLs, no replication |

Five components. One developer can build them. No infrastructure dependencies beyond a Mac with optionally one Linux+GPU box reachable over SSH. Stack alignment with The-Vibe-Company/companion (MIT) lets us vendor specific files (session state machine, stdio transport patterns) with attribution and skip several weeks of scaffolding — see `companion_learnings_v0_1.md`.

---

## 2. P0 features (must build)

### Session management
- Create from: a GitHub issue URL, a plain prompt, a file drop, a PR URL
- Session **types**: tracked-task, freeform, PR-verification
- Resume / park / discard

### Attempt management (inside a session)
- Create an attempt — git worktree branched off a base SHA
- Multiple parallel attempts per session
- Promote one attempt to "candidate" (label, not state)
- Discard an attempt with worktree cleanup

### Codex integration
- Spawn `codex app-server` per attempt with `cwd` set to the attempt's worktree
- Talk JSON-RPC 2.0 newline-delimited over stdio; handshake is `initialize` → `initialized` → `thread/start`
- Persistent thread per attempt; use `thread/resume` to reconnect after process restarts
- Capture the full Codex item lifecycle (`item/started` / `item/updated` / `item/completed`) and translate to a backend-agnostic browser event stream
- Three sandbox modes mapped to Codex enums: `read-only`, `workspace-write`, `danger-full-access` (last requires explicit approval)
- Approval policy: `untrusted` by default; `never` for "bypass" mode
- Tool-approval flow: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` surface to the UI as permission requests; UI response becomes the JSON-RPC response
- Approval gates above and beyond Codex's own: pushing, expensive runs, network access beyond an allowlist

### Run management
- Run a profile-defined command locally
- Run a profile-defined command on a remote runner via SSH
- Capture: stdout, stderr, exit code, declared artifact globs
- Cost estimate + approval gate when projected cost crosses a threshold

### Evidence streaming
- Logs (live)
- Metric events parsed from JSON/JSONL in declared artifact paths
- Frame images (from declared globs)
- Video (mp4 file references)
- Artifact checksums (sha256)
- Every piece of evidence linked to a specific run + attempt + session

### Verification
- Per-profile verification rules:
  - Command exit status
  - Artifact existence checks
  - **One** metric threshold check
- Verification record statuses: `passed`, `passed-with-concerns`, `failed`, `overridden`
- Manual override with logged reason

### PR drafting
- Generate PR body from: session/task context, attempt history, diff, verification record, evidence links, reproduction command
- Push to GitHub via the user's existing auth (gh CLI)
- Comment on the source task with the PR link (GitHub Issue or Jira if configured)

### Profile system
- A `range.yaml` file per repo declaring:
  - Setup commands
  - Reproduce / test / evaluate commands
  - Artifact globs
  - **One** metric definition (path + threshold)
- Profile is read at session creation; not editable inside the app

---

## 3. P1 (named but not built in MVP)

These are flagged so we don't accidentally build them. They're real features for Range, just not for MVP:

- Jira write-back (GitHub-only for MVP; Jira read-only is OK if it falls out for free)
- Slack integration
- Multi-seed verification orchestration (single-seed for MVP; user can call `yard eval` manually)
- Cleanroom verification
- Visual diff / video diff
- Cost budgeting beyond per-run approval (no envelopes yet)
- Trajectory metric predicates (point thresholds only in MVP)
- Cross-repo evidence sharing (Karthik scenario)
- Investigation-mode UI distinct from implementation-mode UI
- Lifecycle cross-task views beyond a flat list
- Team policy / governance
- Audit log surface

---

## 4. Non-goals (won't build, possibly ever in MVP)

- Kubernetes runner abstraction
- Docker-based runner
- Cloud-hosted multi-user version
- A third-party API
- Multiple Codex transports — stdio JSON-RPC (Companion-style) is the only path; WebSocket transport for Codex is feature-flag P1; `codex exec --json` retained only as a fallback for non-interactive batch jobs
- Mobile or responsive UI (desktop browser only)
- Plan view's advanced filtering, search, sorting

---

## 5. Phases (paired with Yard)

### MVP Phase 1 — Local harness (2 weeks)
- The existing HTML mockups wired up to a real backend
- SQLite + filesystem storage
- Codex integration via `codex app-server` over JSON-RPC stdio (Companion-style adapter)
- Local runner only
- Session + attempt creation works
- Basic evidence panel: live logs + artifact list + frame preview
- Manual verification (user marks pass/fail)

**Pairs with Yard Phase 1.** Exit criteria: open Range, type "run yard on warehouse_a seed 42," see logs + a depth frame stream live into the evidence panel.

### MVP Phase 2 — Profile, verification, PR (3-4 weeks)
- `range.yaml` profile system
- Automated verification rules (exit status, artifact existence, one metric threshold)
- PR drafting from evidence
- Push to GitHub
- Approval gates for runs and pushes
- GitHub issue/PR fetching as session sources

**Pairs with Yard Phase 2.** Exit criteria: the Priya scenario runs end-to-end on Yard.

### MVP Phase 3 — Remote runner + cross-layer (3-4 weeks)
- SSH-backed remote runner with worktree sync
- Cross-repo session model (work in `yard-apps` but reach into `yard-engine`)
- Cross-layer evidence handoff (file an issue back to another repo with evidence attached)
- Multi-session view on home page

**Pairs with Yard Phase 3.** Exit criteria: the Anika scenario runs end-to-end across Yard's two repos.

---

## 6. Decisions already made (from earlier work)

These were resolved in prior sessions and don't need re-litigating:

1. **Task load and attempt creation = two steps.** Loading is metadata-only. Attempt creation is explicit and prominent.
2. **Verification = hybrid.** Runs are labeled (`kind: verify`). Verification *records* aggregate runs into a structured judgment.
3. **Candidate = label, not state.** One attempt at a time per session can hold the candidate label.
4. **Guardrails = persistent attempt-state.** Structured constraints visible and editable, with conversational refinement.
5. **Parallel attempts = separate Codex threads.** One orchestration conversation with the user, but each attempt has its own Codex session.
6. **Codex describing visuals = narrator only.** Plain-language description, not authoritative judgment.
7. **PR body = hybrid structured backbone + Codex narrative.** Evidence sections are template-rendered from data and not editable as text; narrative is Codex-drafted, developer-editable.
8. **Top-level term = "sessions"; "attempts" only inside the session view.** Sessions are the umbrella; attempts are an internal mechanism for parallel branches.
9. **Codex transport = `codex app-server` over JSON-RPC stdio,** modeled on The-Vibe-Company/companion's `codex-adapter.ts`. Persistent thread per attempt, resumed via `thread/resume`. WebSocket transport for Codex is post-MVP. `codex exec --json` retained only for non-interactive batch jobs.
10. **Backend stack = Bun + Hono.** Frontend = React + Vite + Tailwind (matching the existing mockups). Decision driven by maximizing borrow-compatibility with Companion under MIT license.

---

## 7. Open decisions to make in Phase 1 (don't block, but commit before Phase 2)

- ~~**Backend language:** Node vs Python.~~ **Decided: Bun + Hono.** Aligns with Companion's stack to maximize code borrowing under MIT; fast startup; bundled tooling. Range itself doesn't need Python in-process — Yard runs as a subprocess via the runner abstraction. See `companion_learnings_v0_1.md`.
- **Codex thread durability:** what happens to a Codex session when Range restarts? For MVP, restart = new thread, with the prior context pack re-passed. Defensible.
- **Frame rendering pipeline:** does Range process video/frame artifacts at all (thumbnailing, scaling), or just serve them raw? Serve raw for MVP; optimize if it bites.
- **Profile vs CLI args:** does the user specify reproduce commands in `range.yaml` or in the conversation? Profile-first, override in conversation if needed.

---

## 8. What MVP success unlocks

After MVP Phase 3, the strategic decision:

1. **Bring in alpha users.** Find 2-3 robotics engineers at NVIDIA or partner companies. Watch them use Range against their own code. Measure pull.
2. **Continue dogfooding.** Extend Yard or fork a more ambitious sim project. Build P1 features driven by lived needs.
3. **Begin Layer 2 (verification + compliance).** Start standardizing the evidence package for regulatory readiness; engage with someone at NVIDIA's safety/regulatory side to validate direction.

The right answer depends on how strongly the MVP demos generate external pull. We'll know by then.

---

## 9. What this MVP deliberately gives up vs. v0.4

To make this honest, the cuts from v0.4 are large:

- **Adapter A, B, C model** → only Adapter A (file + command globs). No SDK emitter, no native simulator adapters. (Note: this refers to the v0.4 spec's *simulation streaming adapter* taxonomy, not the Codex transport choice — Codex itself now uses the app-server stdio path per Companion's pattern.)
- **Multi-seed and cleanroom as verification primitives** → out of MVP; user invokes them manually if needed via the profile's eval command.
- **Investigation mode and implementation mode as distinct UI** → same panel, just different sandbox flag.
- **Profile-defined trajectory metrics** → point metrics only.
- **Approval-budget envelopes** → per-run approval modal.
- **The 13-entity data model** → reduced to: User, Repo, Session, Attempt, Run, Artifact, VerificationRecord, PullRequest. Eight entities. Simpler.
- **Streaming Levels 0-3** → Level 0 (logs/status), Level 1 (metric events), Level 2 (frames + videos as file references). No Level 3 viewport streaming.

These cuts are not permanent — they're MVP-only. v0.4's broader scope is the post-MVP roadmap.

---

## 10. The honest constraint

**MVP must be buildable by one to two people in 8-10 weeks part-time, paired with Yard.** That's the constraint that drives every cut above. If the cuts feel scary, the alternative is worse: a 6-month MVP that ships nothing and gets out-iterated by an OpenAI Cloud feature drop.

Ship Phase 1 fast. Live Yard Phase 1 in it. Iterate.
