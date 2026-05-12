# Range — Product Requirements Document v1.0

**Document type:** Canonical PRD
**Status:** v1.0 — the authoritative product reference. Supersedes earlier specs as the source of truth for *what Range is*.
**Date:** 2026-05-12
**Audience:** Product, engineering, design, future hires, future investors.

This document stands alone. Read it without prior context and you should understand the product, who it's for, why it should exist, and what we're building first.

---

## 0. Status & scope

This PRD describes **Range v1** — the first commercial release. It includes a defined **MVP** (Phase 1–3) that pairs with a dogfood simulator project (Yard) and a clear path forward beyond MVP.

Some referenced supporting documents:

- `range_positioning_v0_1.md` — vendor-independence policy and audience commitments
- `range_sim_stack_support_v0_1.md` — the top-2 simulation stacks Range officially supports
- `companion_learnings_v0_1.md` — what we borrow from the MIT-licensed Companion project
- `yard_product_spec_v0_1.md` — the paired minimal sim used for dogfooding
- `mockups/` — six self-contained HTML mockups of the primary surfaces

---

## 1. Vision

> **Range is the agentic IDE for robot simulation.**

Robot simulation is having its moment. Foundation models, physical AI, and the cost of failed real-world tests are pulling more and more of robotics development into simulators. But the development loop *inside* simulation is still fragmented: code in one tool, sim in another, training metrics elsewhere, results pasted into Slack, no shared evidence model, no shared trust substrate.

Range collapses this loop. It is the workspace where a developer and an AI agent (today, OpenAI Codex) work together on simulated robots — designing scenarios, iterating on reward functions, running multi-seed evaluations, comparing policies, and shipping evidence-backed pull requests. The agent does the work; Range provides the substrate of context, isolation, evidence, and verification that makes the agent's work trustworthy.

**By 2028, our ambition is that opening Range is the default first action of a robot-sim developer's workday — the way opening Figma is for a designer or Linear is for a PM.**

### Why this can be the right product

1. **The agentic loop has a uniquely good fit with robot sim.** Sim work has well-defined success criteria (task completion, multi-seed pass rate, reward distributions). Agents are most productive when they can iterate against measurable outcomes. Most other "agentic IDE" pitches lack this clarity.
2. **The current tooling is genuinely bad.** Robotics teams *build their own* internal versions of Range. This is the strongest signal a market exists — buyers already pay for it, just in engineering salaries.
3. **Vendor neutrality is structurally available.** The center of gravity is shifting toward open, permissive licensing (MuJoCo Apache 2, Isaac Sim 5.0 open-sourced 2025, Drake BSD). A vendor-neutral product is no longer fighting the ecosystem — it's aligned with it.
4. **The agentic infrastructure is ready.** OpenAI Codex (and equivalents) is robust enough to be a dependable backend. MIT-licensed projects like Companion show the orchestration patterns are solved.

---

## 2. Problem

### 2.1 The fragmented dev loop

A typical robotics ML engineer working on a navigation policy in a modern stack has these tools open simultaneously:

- **VSCode or Cursor** for Python code (the policy, the env config, the reward function)
- **A terminal** for launching scripts, ssh-ing into the GPU cluster
- **A simulator** (Isaac Lab, MuJoCo, Gazebo, custom) for visualizing scenes and behaviors
- **W&B or tensorboard** for training metrics
- **GitHub** for PRs and code review
- **Slack** for asking teammates "did this fix actually work?"
- **A notes file or spreadsheet** for tracking experiments

The dev loop is: edit code → launch training → wait minutes-to-hours → check metrics in one tool → watch trajectory in another tool → realize the reward function is wrong → tweak → repeat. Every step is a context switch. Most of the day is glue, not engineering.

### 2.2 Why agents alone don't solve this

Agentic coding tools (Codex, Cursor's agent mode, Claude Code) are powerful but unleashed. For ordinary web development they work because the feedback loop is fast and lossless (run the test, read the failure, fix). For robot sim:

- Feedback is **slow** (a training run is minutes to hours)
- Feedback is **costly** (GPU minutes have a price)
- Feedback is **statistical** (one seed can mislead; multi-seed is mandatory)
- Feedback is **multi-modal** (a metric can pass while the video looks wrong)
- Feedback is **cross-environment** (works in sim, fails on hardware)

An agent that just "runs the next command" produces unreliable work in this domain. The agent needs a substrate that *forces* multi-seed evaluation, *captures* multi-modal evidence, *gates* PRs on verification, and *makes the agent's work auditable*.

That substrate is Range.

### 2.3 Why now (2026)

- **Robot foundation models** (Figure, 1X, Skild, Physical Intelligence, Covariant) are real and well-funded. Each company is bottlenecked on eval infrastructure.
- **Regulatory tailwinds** are starting: NHTSA on AV, FAA on drones, EU AI Act on high-risk autonomy. "Verified in N scenarios across M configurations" becomes a deliverable, not a virtue.
- **MuJoCo's open-source release** and the community's pivot toward portable stacks (mjlab on top of MuJoCo+Warp) signal that the ecosystem wants vendor-neutral tooling.
- **Codex (and equivalents) are production-grade.** The agent layer is no longer the bottleneck.
- **Companion-style orchestration patterns are open-sourced** — we don't have to invent the substrate from scratch.

The category will be defined in the next 24 months. Whoever shows up first with a credible, vendor-neutral, agentic-by-default product captures the category.

---

## 3. Target users

### 3.1 Primary (the wedge): Robot ML engineer

**Profile.** Mid-to-senior engineer at an embodied-AI startup, AV company, or robotics research lab. Lives in Python. Comfortable with PyTorch, MuJoCo or Isaac Lab, ssh-ing into GPU boxes. Their day is reward shaping, policy iteration, scenario authoring, multi-seed eval.

**Top pains today:**
1. *"My change improved one seed but regressed another. I don't know which is real."*
2. *"It works in sim, fails on the real robot. I have no shared evidence trail to debug from."*
3. *"I shipped a change and a teammate found it broke their scenario two weeks later."*
4. *"Reproducing a result from last month means re-running everything from scratch."*

**What Range gives them.** Multi-seed eval as the default. Evidence (logs, metrics, trajectories, videos) bound to runs with checksums and SHAs. Reproducibility from a single command. PRs that carry the evidence reviewers actually need.

### 3.2 Secondary: Production robotics engineer

**Profile.** Engineer at a robotics company shipping physical hardware — mobile robots, drones, AV, industrial automation. ROS 2 + Gazebo native. Their day is integration, sensor fusion, navigation tuning, regression testing.

**Top pains today:**
1. *"I can't easily compare two sensor stacks side-by-side."*
2. *"My regression suite is 200 rosbags and a spreadsheet."*
3. *"Telemetry from the field is in a different tool than my sim work."*

**What Range gives them.** A single workspace for sim and (eventually) telemetry. Rosbag-aware evidence model. Multi-config verification (across sensor models, GPU archs, etc.). Cross-team evidence handoff.

### 3.3 Tertiary: Robot sim platform developer

**Profile.** Engineer at NVIDIA, Google DeepMind, Open Robotics, or a robotics-company platform team. Builds the layer that other developers consume — Isaac Lab, mjlab, internal training harnesses, custom simulators.

**Top pains today:**
1. *"My users report subtle regressions I can't reproduce."*
2. *"My change broke 3 of 12 downstream consumers in ways I didn't predict."*
3. *"I review PRs without confidence; the author says it works."*

**What Range gives them.** Cross-layer debugging (run against multiple versions of a dependency). Customer-bug reproduction from artifact dumps. PR verification with evidence before merge.

### 3.4 Adjacent: PMs, tech leads, reviewers

Range's evidence-backed PRs are designed to be reviewable by people who didn't author the work. The "Plan" surface aggregates PRs across the org so PMs can see velocity and verification status. We don't optimize for these users primarily, but we earn their trust as the developer-facing wedge lands.

---

## 4. Product

### 4.1 One-line

> Range is the agentic IDE for robot simulation — a workspace where an AI agent works alongside you on simulated robots, with structured evidence and verification baked into every PR.

### 4.2 The proving ground metaphor

Range is a **proving ground**: a place you take an attempt at solving a robot-sim problem before it becomes a commitment to ship. Multiple attempts can coexist. Each attempt produces evidence. The evidence becomes the PR.

The metaphor matters because it sets expectations:
- Attempts are cheap to spin up and cheap to discard
- An attempt is a hypothesis, not a commitment
- The artifact that leaves Range is *evidence* (a PR, a finding, a comparison), not a build

### 4.3 What Range is

- An agentic workspace for robot simulation work
- A session/attempt/run/evidence model with first-class verification
- A profile-driven harness — users bring their stack via `range.yaml`
- A local-first product that scales to remote runners (GPU clusters, SSH hosts)
- An open, MIT-licensed, vendor-neutral platform

### 4.4 What Range is not

- Not a code editor — we don't compete with Cursor / VSCode
- Not a simulator — we orchestrate MuJoCo / Gazebo / Drake / Isaac Lab / custom
- Not a data viz tool — Foxglove owns that surface; we integrate, don't replace
- Not a fleet manager or hardware-deployment tool *yet* (future expansion)
- Not a closed or vendor-bound ecosystem

---

## 5. Core concepts

A small, deliberate vocabulary. Every user-facing concept maps to a backend entity.

| Concept | Definition |
|---|---|
| **Session** | A top-level container for a unit of work. Has a kind: `tracked_task`, `freeform`, or `pr_verification`. Holds attempts. |
| **Attempt** | An isolated branch of work inside a session, with its own git worktree, agent thread, runs, and evidence. Multiple attempts per session can run in parallel. |
| **Scenario** | A reproducible test case: robot + world + task + success criteria. Profile-defined. The unit a session is "about." |
| **Run** | One execution of a command inside an attempt. Has a `kind` (`reproduce`, `evaluate`, `verify`, `train`, etc.), captures stdout, stderr, exit code, and declared artifacts. |
| **Artifact** | Any structured output of a run: logs, metric JSON, frame images, video, trajectory file. Checksummed and linked to its run. |
| **Evidence** | The cross-cutting collection of artifacts + parsed metric events + frame events + run metadata that justifies a verification claim. |
| **Verification record** | A structured judgment over one or more runs: status (`passed` / `passed-with-concerns` / `failed` / `overridden`), per-check results, override reasons. Gates PR push. |
| **Profile** | A `range.yaml` per repo declaring setup, commands, artifact globs, metric thresholds, scenarios. The contract between Range and the user's stack. |

The terminology rule (per earlier decision): **sessions** is the top-level umbrella in the UI; **attempts** is internal to the session. Users say "I'm working on the SIM-1842 session"; inside it they may have three attempts.

---

## 6. User stories

Twelve stories spanning the canonical loop. Each: `As a [persona], I want [capability] so that [outcome]`, plus acceptance criteria.

### 6.1 Bring work into Range

**As a** robot ML engineer
**I want to** start a session from a Jira task, a freeform description, or a PR URL
**So that** my entry point matches the shape of work I have

**Acceptance:**
- Composer accepts: tracker ID (`SIM-1842`), URL, freeform text
- Range proposes the matching session kind and profile
- Nothing irreversible (worktree, GPU spend) happens before I confirm
- For PRs, Range fetches the branch and enters verification mode

### 6.2 Reproduce a known failure

**As a** robot ML engineer
**I want** Range to spin up a baseline attempt and run the profile's reproduce command
**So that** I have ground-truth evidence the bug exists before any change is contemplated

**Acceptance:**
- A `baseline-main` attempt is created from a recorded base SHA
- Logs, metrics, frames, video stream live into the evidence panel
- Result is labeled clearly: *reproduced / not reproduced / partially reproduced* (latter for statistical tasks)
- Expensive runs (remote GPU) prompt for confirmation with cost estimate
- All evidence is checksum-pinned and linked to the attempt

### 6.3 Investigate with Codex in read-only mode

**As a** robot ML engineer
**I want to** send Codex into the repo with no write access and see its reasoning
**So that** it forms hypotheses without making unauthorized changes

**Acceptance:**
- Sandbox is `read-only`; writes are blocked at the agent level
- I can steer Codex conversationally ("focus on the planner module, ignore the data loader")
- Codex's command activity streams live with structured events (`item/started` → `item/completed`)
- Hypotheses surface as structured artifacts, each linked to the evidence it rests on

### 6.4 Implement a fix with guardrails

**As a** robotics ML engineer
**I want to** declare constraints conversationally before Codex acts
**So that** Codex stays inside the bounds I trust

**Acceptance:**
- Constraints expressed in natural language ("don't touch the planner API, only modify the reward function, no scenario config changes")
- Range translates to a structured guardrail set visible in the attempt header
- Guardrail violations trigger an approval gate, not silent block
- Guardrails appear in the eventual PR's evidence section

### 6.5 Run parallel attempts

**As a** robot ML engineer
**I want to** spin up two implementation attempts from the same base
**So that** I can compare two real diffs instead of arguing about hypotheticals

**Acceptance:**
- Each attempt has its own worktree and Codex thread
- Both stay live and switchable; evidence panel reflects the active attempt
- One-writer-per-worktree enforced
- Compare-attempts view shows diff, runs, and verification side-by-side

### 6.6 Multi-seed verify a candidate

**As a** robot ML engineer
**I want** the verification command to run across N seeds by default
**So that** I never ship a fix based on one lucky seed

**Acceptance:**
- N from profile (default 5)
- Per-seed evidence preserved; results not silently averaged
- Aggregate result: pass rate, metric distribution, outliers flagged
- Verification record reflects statistical shape, not a single number

### 6.7 Catch "looks wrong" even when "passes the metric"

**As a** simulation developer
**I want to** scrub trajectory videos and pin step ranges as concerns
**So that** a visually broken run doesn't ship just because the metric passed

**Acceptance:**
- Episode replay player synchronizes video, trajectory plot, reward curve, action stream
- Side-by-side comparison against baseline
- A pinned concern attaches to the verification record as `passed-with-concerns`
- Codex describes visible differences but never declares them authoritative

### 6.8 Cross-layer debugging

**As a** simulation platform developer
**I want to** pin the version of an upstream dependency and re-run to isolate cause
**So that** I can tell if a bug is in my code or underneath it

**Acceptance:**
- A profile can declare dependency pins
- Range can spawn an attempt with a custom pin (e.g., MuJoCo 3.4 instead of 3.5)
- Comparing pinned attempts shows which version exhibits the bug
- The bisect-style result becomes evidence for the upstream filing

### 6.9 Hand off across team boundaries

**As a** simulation platform developer
**I want to** file a downstream-found bug back to the upstream team with full evidence
**So that** they don't have to re-derive what I just found

**Acceptance:**
- "File back" generates a structured ticket in the target tracker
- Ticket includes reproduction, bisect evidence, repro script, all linked artifacts
- Source-side ticket is automatically marked `upstream-pending`
- Upstream-pending status is reflected when the target ticket changes

### 6.10 Ship an evidence-backed PR

**As a** robot ML engineer
**I want** Range to draft a PR body from the verification record, attempt history, and diff
**So that** the evidence section is structurally complete by default

**Acceptance:**
- Body has a structured backbone (verification record, files changed, metric deltas, artifact links, reproduction command, guardrails) that's template-rendered from data and not editable as text
- Narrative sections (summary, motivation, known risks) are Codex-drafted, developer-editable
- Reproduction command is exact and runnable, pinned to commit SHA + runner profile
- Push is an explicit action, never silent

### 6.11 Verify someone else's PR

**As a** tech lead
**I want to** drop a PR URL into Range and have it run the full verification suite
**So that** I can review with confidence the author's claims hold

**Acceptance:**
- PR-verification session checks out the head SHA
- Codex is read-only; only verification commands run
- Cleanroom verification available with one request
- Findings can be posted as a PR comment (with my approval)

### 6.12 Resume yesterday's work

**As a** robot ML engineer
**I want to** resume a session from yesterday with full context intact
**So that** I don't have to re-read my own work to remember where I was

**Acceptance:**
- Worktree, Codex thread, evidence panel all restore
- Lost state is named explicitly (e.g., remote runner artifacts GC'd)
- "What changed while you were away" surface (main branch moved, related PR opened)
- The conversation feels continuous, not "let me re-read the transcript"

(Additional stories around Lifecycle, Origination from artifact dumps, and cross-task views exist in earlier docs; the above 12 are the V1 priority set.)

---

## 7. UX overview

### 7.1 Information architecture

Range has four top-level surfaces:

```
┌────────────────────────────────────────────────────────────────┐
│  Range  ▸  Home  ·  Plan  ·  Sessions [3]  ·  History   ⌘K  ◐│
└────────────────────────────────────────────────────────────────┘
            │        │           │             │
            ▼        ▼           ▼             ▼
         Home    Plan view   Session list   History
       (composer)  (all      (currently      (closed
        + recent    PRs)      in-flight)     work)
       sessions)
                              │
                              ▼
                        ┌──────────────┐
                        │ Session view │
                        │ (3-column:   │
                        │  attempts /  │
                        │  agent stream│
                        │  / evidence) │
                        └──────────────┘
```

The **Auth flow** sits before any of these on first launch.

### 7.2 The Home surface

The conversational entry point. A composer that accepts any input shape (task ID, freeform prompt, PR URL), with quick-action chips for explicit kinds.

```
┌──────────────────────────────────────────────────────────────┐
│  monday · may 11 · 9:42am                                    │
│                                                              │
│  What are we working on, today?                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  pull in SIM-1842 and reproduce the failure on H100  ▌ │  │
│  │                                                        │  │
│  │  ───────────────────────────────────────────────────── │  │
│  │  robot-nav-sim ⌄    ⏎ to send                    [go] │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  starters:  [freeform]  [tracked task]  [verify a PR]        │
│                                                              │
│  ── In flight ───────────────────────────────  3 sessions   │
│  ● SIM-1842 · codex-fix-minimal     codex working  4m elapsed│
│  ● TRAIN-2104 · codex-investigate   awaiting you   paused 2h │
│  ● RENDER-87 · verifying PR #4612   cleanroom queued         │
│                                                              │
│  ── Assigned to you ─────────────────────────────  5 tasks  │
│  P0  SIM-1850   Sensor occlusion produces NaN     jira   2h │
│  P1  RENDER-91  Camera intrinsics drift           jira   5h │
│  ...                                                         │
│                                                              │
│  ── Picked up recently ────────────────────  last 7 days    │
│  merged    SIM-1789  Replay buffer ordering fix       5d   │
│  opened    SIM-1801  Stabilize trajectory recording   2d   │
│  archived  TRAIN-2098 (hypothesis ruled out)          3d   │
└──────────────────────────────────────────────────────────────┘

Authoritative reference: mockups/mockup-home.html
```

### 7.3 The Live Session surface

Where most of the work happens. A 3-column layout: attempts on the left, conversation/agent stream in the center, evidence on the right.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Range │ robot-nav-sim › SIM-1842 › codex-fix-minimal ● live │ ⌘K  ◐  DP │
├──────────────┬─────────────────────────────────────┬────────────────────┤
│  SIM-1842    │ codex-fix-minimal · workspace-write │ Evidence  3        │
│  Navigation  │ guardrails: src/nav/ only ·         │ ─────────────────  │
│  regression  │            no planner API ·         │ Files changed  2   │
│              │            ≤2GB GPU                 │  src/nav/replay_…  │
│  Attempts 4  │ ─────────────────────────────────── │  tests/nav/test_…  │
│  ● baseline  │  you (4m):                          │ ─────────────────  │
│    PASSED    │  let codex make the smallest safe   │ Runs  3            │
│  ○ investig  │  fix in a separate attempt          │  ✓ reproduce       │
│  ● fix-min   │                                     │  ✓ pytest          │
│    LIVE      │  range (4m):                        │  ● LIVE reproduce  │
│    codex     │  created codex-fix-minimal from     │    w/ fix          │
│    working   │  main@abc123. workspace-write       │    success_rate    │
│  ○ fix-bold  │  sandbox.                           │    0.91 → 0.92     │
│    QUEUED    │                                     │    [frame thumb]   │
│              │  codex (3m):                        │    [sparkline]     │
│  Context     │  starting with the replay buffer.   │    eta ~40s        │
│  ● task body │  the investigation flagged          │ ─────────────────  │
│  ● investig  │  _advance_pointer as likely site.   │ Verification       │
│    summary   │                                     │  ○ success_rate    │
│  ● failing   │  $ rg "advance_pointer" src/nav/    │    ≥ 0.92          │
│    log       │   3 matches in 1 file                │    pending         │
│              │                                     │  ○ collisions = 0  │
│  GPU 3.2/12h │  codex (2m):                        │    pending         │
│  rg-h100-12  │  confirmed. the pointer is advanced │  ✓ no unintended   │
│              │  before timestamp stamping. swap-   │    files changed   │
│              │  ping order fixes it.               │                    │
│              │                                     │                    │
│              │  [edit cell: src/nav/replay_buffer  │                    │
│              │   +12 −2  show diff]                │                    │
│              │                                     │                    │
│              │  [composer: pause | redirect | ▶ ]  │                    │
└──────────────┴─────────────────────────────────────┴────────────────────┘

Authoritative reference: mockups/mockup-implementation.html
```

The live run cell — with streaming metrics, frame thumbnails, and sparklines — is the most novel element. It's where "agentic IDE for robot sim" feels real.

### 7.4 The Plan surface

Bird's-eye view of every PR being verified, drafted, opened, in review, merged, or failed.

```
┌───────────────────────────────────────────────────────────────────────┐
│  every PR, every piece of evidence                                    │
│                                                                       │
│  PRs this week 12  │  evidence complete 89%  │  task→PR 2.4h  │ 3 live│
│                                                                       │
│  [all 12] [mine 7] · [verifying 3] [drafts 1] [open 4] [merged 6]    │
│                                                                       │
│  ┃ ● drafting     SIM-1842  Fix replay buffer ordering             ┃  │
│  ┃                ◯ ◯ ◯ ●   1/4 · running    success_rate 0.91→tgt┃  │
│  ┃ ● verifying    RENDER-87 Fix lidar timestamp drift              ┃  │
│  ┃                ● ● ◯ ◯   2/4 · cleanroom   drift_ms 42→4       ┃  │
│  ┃ ◐ open #4607   SIM-1801  Stabilize trajectory recording         ┃  │
│  ┃                ● ● ● ●   all passed         jitter_ms 12→1.4   ┃  │
│  ┃ ⚠ concerns     SIM-1820  Lower replay buffer memory             ┃  │
│  ┃                ● ● ● !   3/4 · 1 concern    memory −14%        ┃  │
│  ┃ ✗ failed       TRAIN-2104 Revert data loader sampler            ┃  │
│  ┃                ● ● ✗ ●   2/5 seeds regressed                   ┃  │
│  ┃ ✓ merged #4598 SIM-1789  Replay buffer ordering fix             ┃  │
│  ┃                ● ● ● ●   success_rate 0.87→0.94                ┃  │
└───────────────────────────────────────────────────────────────────────┘

Authoritative reference: mockups/mockup-plan.html
```

The check-dot pattern (4 small circles per row) is the differentiator from a normal GitHub PR list — it surfaces verification at a glance.

### 7.5 The Freeform Session surface

For when work doesn't have a tracker entry yet. Same shape as a tracked-task session, but with a `freeform` indicator, an "inferred context" panel, and a "promote to tracked task" affordance.

```
┌────────────────────────────────────────────────────────────────────┐
│ Range │ freeform › untitled — warehouse weirdness │ ⌘K  ◐  DP      │
├──────────────┬──────────────────────────────────────┬──────────────┤
│ freeform     │ freeform session · no task · repo:   │ Evidence  0  │
│ session      │ robot-nav-sim                        │              │
│              │                                      │ ─ nothing    │
│ ssn_a92f     │  you: i want to debug the warehouse  │   captured   │
│              │  scenario in robot-nav-sim.          │   yet ─      │
│ no tracked   │  the navigation is acting weird.     │              │
│ task         │                                      │ this panel   │
│ [file SIM]   │  range: good — i'll set up a free-   │ fills as     │
│              │  form session.  three angles:        │ soon as work │
│ Inferred     │   1. reproduce on a few seeds        │ happens.     │
│ ● robot-nav  │   2. look at planner history (free)  │              │
│ ● planner    │   3. codex reads planner read-only   │ [files]      │
│ ● warehouse  │      [RECOMMENDED]                   │ [metrics]    │
│ ● ~10% coll  │                                      │ [verification│
│              │  you: go with 2 + 3.                 │   awaits     │
│ promote:     │                                      │   criteria]  │
│ [jira] [gh]  │  range: done. starting freeform-     │              │
│ [just PR]    │  investigate read-only and pulling   │ [+ attach    │
│              │  planner history.                    │   existing   │
│              │                                      │   evidence]  │
└──────────────┴──────────────────────────────────────┴──────────────┘

Authoritative reference: mockups/mockup-session-freeform.html
```

### 7.6 Auth & onboarding

Two-step: sign in (GitHub OAuth), then connect optional services (Jira via API token, Slack optional). None of it gates getting to work — Range works with just GitHub connected.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌─────────────────┐  │  step 2 of 3                          │
│   │                 │  │                                       │
│   │     RANGE       │  │  Connect the things                   │
│   │                 │  │  Codex will need.                     │
│   │  a proving      │  │                                       │
│   │  ground for     │  │  ● github   connected                 │
│   │  codex.         │  │    nvidia-isaac · 14 repos            │
│   │                 │  │                                       │
│   │                 │  │  ◐ jira     fetching projects…        │
│   │  codex-first ·  │  │    nvidia.atlassian.net               │
│   │  sim-aware ·    │  │    SIM 142 · RENDER 38 · TRAIN 61     │
│   │  evidence-      │  │                                       │
│   │  backed         │  │  ◯ slack    optional         [connect]│
│   │                 │  │                                       │
│   │                 │  │  + linear, gitlab, sentry, w&b later  │
│   │                 │  │                                       │
│   │                 │  │  [continue to range →]                │
│   │                 │  │   or skip jira for now                │
│   │   SOC 2 · SSO   │  │                                       │
│   └─────────────────┘  │                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Authoritative reference: mockups/mockup-auth.html
```

### 7.7 Theme system

Range ships with both dark (default) and light themes. Phosphor-yellow accent for "live" states (CRT phosphor reference). Toggle in every top bar, preference persisted in `localStorage`, first-launch reads `prefers-color-scheme`.

Typography: Bricolage Grotesque (display), Geist (UI), JetBrains Mono (data/code). Color palette uses `oklch()` for perceptually uniform shifts between modes.

---

## 8. Technical architecture

### 8.1 Components

```
                  ┌──────────────────────────────────────────┐
                  │  Browser (React 19 + Vite + Tailwind v4) │
                  └────────────┬─────────────────────────────┘
                               │  WebSocket + REST
                               │  (ws://host/ws + /api/*)
                  ┌────────────▼─────────────────────────────┐
                  │  Bun + Hono server                       │
                  │  ┌─────────┐ ┌──────────┐ ┌───────────┐  │
                  │  │  HTTP   │ │   WS     │ │   Pub/sub │  │
                  │  │ routes  │ │ bridge   │ │   (hub)   │  │
                  │  └────┬────┘ └────┬─────┘ └─────┬─────┘  │
                  │       │           │              │        │
                  │  ┌────▼───────────▼──────────────▼─────┐ │
                  │  │  Domain: sessions, attempts, runs,  │ │
                  │  │   verification, evidence, profiles  │ │
                  │  └────┬────────────────────────────────┘ │
                  │       │                                   │
                  │  ┌────▼─────┐  ┌──────────┐  ┌─────────┐ │
                  │  │ bun:     │  │ Codex    │  │ Runner  │ │
                  │  │ sqlite   │  │ adapter  │  │ manager │ │
                  │  └──────────┘  └────┬─────┘  └────┬────┘ │
                  └──────────────────────┼─────────────┼─────┘
                              JSON-RPC stdio          │
                                  ▼                   ▼
                       ┌────────────────┐    ┌──────────────────┐
                       │ codex          │    │  Subprocess      │
                       │ app-server     │    │  - local shell   │
                       │ (subprocess)   │    │  - ssh remote    │
                       └────────────────┘    │  - sim/training  │
                                             └──────────────────┘
```

### 8.2 Stack

**Frontend:** React 19, Vite, Tailwind v4, Zustand for high-frequency state, `@tanstack/react-virtual` for long lists, `useSyncExternalStore` for the WebSocket subscription (avoids unnecessary re-renders).

**Backend:** Bun (the runtime), Hono (the HTTP/WebSocket framework). Why Bun: native WebSocket, `bun:sqlite` (fastest JS SQLite binding), no transpile step for TypeScript, fast cold start. Why Hono: minimal, fast, native Bun WebSocket support, well-typed.

**Storage:** SQLite via `bun:sqlite`, in WAL mode, foreign keys on. Schema applied via idempotent migrations on boot. Default location: `~/.range/range.db` (override via `RANGE_DB` env).

**Agent integration:** OpenAI Codex via `codex app-server` subprocess + JSON-RPC 2.0 newline-delimited over stdio. Modeled directly on Companion's `codex-adapter.ts` (MIT). Persistent thread per attempt; resume via `thread/resume`. WebSocket transport for Codex is feature-flag P1.

**Auth:** Local token at `~/.range/auth.json`, auto-generated on first start. Web/mobile WebSocket clients connect with the token as a query param. Designed for local-first multi-machine reach via Tailscale, not multi-tenant SaaS.

**Build / packaging:** Distributed as an npm package, runnable via `bunx the-range` (subject to availability of the name). Single-binary distribution post-MVP.

### 8.3 Data model

```
User ──< Repo ──< Session ──< Attempt ──< Run ──< Artifact
                     │            │         │
                     │            │         └──< Evidence event
                     │            │
                     │            └──< Codex thread
                     │            └──< Worktree
                     │            └──< Verification record
                     │
                     └──< Pull request (0..1)

Session has kind: tracked_task | freeform | pr_verification
Attempt has label: candidate (0 or 1 per session)
Run has kind: reproduce | verify | evaluate | train | render | shell
VerificationRecord aggregates 1+ runs into a structured judgment
```

Eight core entities. Simpler than the v0.4 spec's 13. SQLite tables map cleanly.

### 8.4 Wire protocol

REST for state-changing operations (POST/PUT/DELETE) and one-shot reads. WebSocket for streaming events and live updates.

**REST surface (MVP):**
- `GET  /api/health`
- `GET  /api/sessions`
- `POST /api/sessions`
- `GET  /api/sessions/:id`
- `POST /api/sessions/:id/attempts`
- `POST /api/attempts/:id/runs`
- `GET  /api/runs/:id`
- `GET  /api/runs/:id/artifacts/:path` (signed file access)
- `POST /api/attempts/:id/pr` (draft + push)

**WebSocket events (server → browser):**
- `hello`, `ping`
- `session_created`, `session_updated`, `session_archived`
- `attempt_created`, `attempt_updated`
- `run_started`, `run_log`, `run_metric`, `run_frame`, `run_finished`
- `agent_event` (translated Codex item)
- `permission_request`
- `verification_record_updated`

**WebSocket events (browser → server):**
- `pong`
- `permission_response`
- `agent_message` (user → agent)
- `agent_interrupt`

A full protocol contract document (`docs/range_protocol_v0_1.md`) gets written before Phase 2 implementation.

### 8.5 Codex integration

Per `companion_learnings_v0_1.md`, we use the same path Companion uses for Codex:

1. Server spawns `codex app-server` with the attempt's worktree as `cwd`
2. Server sends `initialize` → server receives capabilities
3. Server sends `initialized` → handshake complete
4. Server sends `thread/start` (or `thread/resume`) with model, approvalPolicy, sandbox
5. Codex emits notifications: `item/started`, `item/updated`, `item/completed`
6. Codex emits requests: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`
7. Server translates Codex items into Range's browser event protocol via the adapter

Adapter is the most complex single component. Plan to vendor Companion's adapter pattern with MIT attribution and adapt to Range-specific event names.

### 8.6 Runner model

Two runner kinds in MVP:

**Local runner.** Spawns child processes on the host machine. Watches declared artifact globs via `chokidar` (or Bun's `fs.watch`). Streams stdout/stderr line-by-line to the WS bus. Suitable for fast iteration on a Mac during development.

**SSH-backed remote runner.** Manages a long-lived SSH connection to a Linux host (GPU box). Uses rsync to sync the worktree, then runs commands remotely, streams output back, retrieves artifacts. Suitable for training runs and multi-seed eval.

Both runners share a common interface: `runCommand(command, profile, cwd) → Stream<RunEvent>`. Adding a third runner kind (container, Kubernetes) is a future addition that doesn't change the interface.

---

## 9. Target stacks + plugin model

### 9.1 Officially supported in MVP

**MuJoCo (Apache 2.0)** — primary, where the agentic wedge lands hardest. Yard ships as the canonical MuJoCo demo project.

**ROS 2 + Gazebo (Apache 2.0)** — secondary, the production-robotics standard. A turtlebot navigation scene ships as the canonical Gazebo demo.

Both are vendor-neutral and align with our positioning policy.

### 9.2 Pluggable later

Other stacks integrate via the **profile model**: a user's `range.yaml` declares the commands, artifacts, metrics, and scenarios for their stack. Range orchestrates against this contract. No core code change needed.

Additionally, a future **adapter plugin** mechanism lets community contributors add stack-specific evidence parsers:

```ts
// docs/range_plugin_spec_v1.md (future)
interface StackAdapter {
  name: string;
  parseLog(stream: ReadableStream): AsyncIterable<RunEvent>;
  parseArtifact(path: string): Promise<EvidenceItem>;
  defaultProfile(): RangeYamlSnippet;
}
```

Honorable mention for future first-party support: **Drake** (BSD, ~3.9K stars, Toyota Research). Add when adoption justifies.

### 9.3 What "officially supported" means

For each top-2 stack, MVP ships:

- A known-good `range.yaml` template
- A 15-minute quickstart guide
- An evidence parser tuned for the stack's log format
- One canonical demo scenario

### 9.4 What we explicitly don't anchor on

Per `range_positioning_v0_1.md`:

- Isaac Sim / Isaac Lab — supported as *user stacks* only. We do not take a dependency on them. Users can declare them in their `range.yaml`; Range orchestrates them like any other Python dep.
- Omniverse Kit — forbidden as a Range core dependency.
- Anything requiring NDA / non-public NVIDIA APIs.

---

## 10. Roadmap

### 10.1 MVP — Phase 1 to Phase 3 (8-10 weeks part-time)

Paired phase-by-phase with the Yard dogfood sim. See `range_mvp_spec_v0_1.md` and `yard_product_spec_v0_1.md` for detail.

**Phase 1: Local foundation (2 weeks)**
- ✅ Scaffold: Bun + Hono server, React + Vite frontend, WebSocket bridge
- ✅ Sessions: SQLite schema, POST/GET/list APIs, home composer, session view stub
- ⏳ Attempts + worktrees: per-session attempts, git worktree management
- ⏳ Local runner: spawn profile-defined commands, capture stdout/exit/artifacts

**Phase 2: Agent + verification + PR (3-4 weeks)**
- ⏳ Codex adapter: `codex app-server` subprocess, JSON-RPC stdio, item lifecycle translation
- ⏳ Profile system: `range.yaml` parser
- ⏳ Verification engine: rules → records, gating PR
- ⏳ PR drafting: structured body + push via `gh`
- ⏳ Approval gates for sensitive actions

**Phase 3: Remote + cross-layer (3-4 weeks)**
- ⏳ SSH remote runner: worktree sync, command exec, artifact retrieval
- ⏳ Multi-seed eval orchestration (MuJoCo)
- ⏳ Cross-layer evidence handoff (file back to upstream tracker)
- ⏳ ROS 2 + Gazebo demo profile ships

### 10.2 Year 1 (post-MVP)

- Episode replay player (the most demoable feature for this audience)
- Multi-runner orchestration (parallel attempts on different GPUs)
- Drake support
- Better cleanroom verification (containerized reruns)
- VSCode/Cursor extension that surfaces Range sessions from the editor
- Real-robot telemetry ingestion (rosbag → evidence)

### 10.3 Year 2+

- Real-hardware deployment connector (push policy to robot, monitor)
- Fleet view (multiple robots in the field)
- Linear / GitLab / internal tracker integrations
- Team policies / audit / governance
- Cloud-hosted multi-user version (current MVP is local-first)

### 10.4 The north star

By 2028, Range is the unified workspace for the loop from sim through deployment for the robotics industry. Each year's roadmap earns the next year's expansion.

---

## 11. Success metrics

### 11.1 Activation (week 1 of a new user)

- Time from first launch to first session created
- Time from first session to first run completing
- Time from first session to first evidence-backed PR drafted
- Target: all three under 30 minutes for the canonical MuJoCo path

### 11.2 Engagement (steady state)

- Sessions per developer per week (target: 5+)
- Attempts per session (target: 1.5-3, indicating real iteration without sprawl)
- % of weekly sessions that culminate in a PR (target: 60%+ for tracked-task sessions)
- WAU / MAU ratio (target: >50%)

### 11.3 Wedge metrics

- % of PRs produced through Range that have a complete evidence package (target: 80%+)
- % of verification records that *gate* a PR push (target: high — the gate is doing its job)
- Reviewer acceptance rate for Range PRs vs. team average (target: equal or better)

### 11.4 Trust signals

- Multi-seed eval as default behavior, not opt-in
- Approval-gate denial rate (low rate suggests gates are well-tuned; high rate suggests over-gating)
- Reproduce-from-PR success rate (target: 95%+)

---

## 12. Non-goals & risks

### 12.1 Non-goals (deliberately not building)

- A code editor (Cursor / VSCode own this)
- A simulator (MuJoCo / Gazebo / Drake own this)
- A data viz tool (Foxglove owns this; we may integrate)
- A model training framework (PyTorch / JAX own this)
- A fleet manager (future expansion, not MVP)
- A SaaS multi-tenant version in MVP (local-first; multi-tenant comes when economics demand it)
- Mobile UI in MVP (Companion has one; we don't need it)
- A general-purpose dev tool — we are domain-deep, not domain-shallow

### 12.2 Risks

- **Cursor adds robot-sim awareness.** Mitigation: deeper domain depth, evidence model, multi-runner orchestration are non-trivial to clone. Build moat through specificity.
- **Foxglove adds an agentic layer.** Mitigation: they're viz-first, we're loop-first. Different surface. Could be partner more than competitor.
- **MuJoCo community fragments.** Mitigation: support multiple stacks (top-2 design), profile-driven means we absorb fragmentation as plugin work.
- **NVIDIA builds a competing dev tool.** Mitigation: per the Kit-disaggregation update, NVIDIA's direction is library-first, not tool-first. Our vendor-neutral positioning is complementary.
- **Codex pricing or terms shift.** Mitigation: `CodexAdapter` interface allows future adapter swaps (Claude Code, Gemini-CLI). Single-vendor agent dependence is a known risk to manage, not eliminate.
- **MVP scope creeps.** Mitigation: paired phases with Yard force discipline; each phase has explicit exit criteria.
- **First user research never happens.** Mitigation: the founder is at NVIDIA with privileged access to real Isaac Lab / sim users. Schedule conversations early, not after MVP ships.

### 12.3 Open questions

These don't block MVP but should be resolved before public launch:

- Pricing model (per-seat? per-org? free for individuals?)
- License of Range itself (currently MIT — confirm before commercial launch)
- Cloud-hosted vs. local-only as the marketed default
- Telemetry (do we collect anonymous usage data? what's our policy?)
- Brand identity beyond the wordmark (logo, color system extensions, motion language)

---

## 13. Appendices

### A. Persona vignettes (condensed)

Three condensed personas tied to specific real public stacks. Full versions in `docs/range_scenarios_v0_1.md`.

**Priya — ovrtx core developer.** Maintains sensor sim at NVIDIA. Day: triage customer bug reports, ship fixes, review PRs. Range scenario: customer sends a USD scene + lidar config, Priya reproduces on H100 + Ada, ships a fix with a customer-facing summary in 25 minutes.

**Anika — Isaac Lab developer.** Maintains Isaac Lab's sensor abstractions. Day: handle user-reported issues that often cross her wrapper into ovrtx. Range scenario: user reports depth noise in Lab 2.6 vs 2.5; Anika bisects across versions and a pinned upstream dependency, identifies it as an ovrtx regression (not her wrapper), files an evidence-backed upstream ticket.

**Karthik — AV sensor-sim engineer.** Builds proprietary synthetic data pipeline on ovrtx. Day: defend his work against blame from the perception team's regressions. Range scenario: perception team flags 3% mAP drop; Karthik re-verifies his old PR with their new eval dataset, proves his change wasn't the cause, shares the evidence record with the perception team.

### B. Companion borrowing summary

Per `companion_learnings_v0_1.md`, we vendor specific patterns from The-Vibe-Company/companion (MIT):

- `session-state-machine.ts` (8-phase state machine, ~200 lines)
- `IBackendAdapter` abstraction pattern
- Codex item lifecycle mapping
- Stdio transport wrapper
- Approval flow
- Sandbox + approval policy enum mappings
- Auth-token-in-file model
- Worktree tracker

We do *not* vendor: their mobile UI, Linear-specific integration, deep generic chat surface. License attribution required where we copy code substantively.

### C. Mockup reference

Six self-contained HTML mockups serve as authoritative visual references:

- `mockups/mockup-index.html` — launcher
- `mockups/mockup-auth.html` — connect GitHub / Jira / Slack
- `mockups/mockup-home.html` — composer + recent sessions
- `mockups/mockup-plan.html` — all PRs
- `mockups/mockup-session-freeform.html` — freeform session in shaping
- `mockups/mockup-implementation.html` — live Codex session with evidence

Each has dark/light theme support and renders without a build step.

### D. Yard — the dogfood sim

A deliberately minimal robotics simulator built on MuJoCo + USD + Python that Range uses to dogfood itself. One robot, one warehouse scene, one depth camera, one navigation task, multi-seed eval. Codebase capped at 2,000 lines as a forcing function. Full spec in `yard_product_spec_v0_1.md`.

Yard is not the product. Range is. Yard exists so Range stays honest.

---

## 14. Authority

This PRD is the canonical product reference. When it conflicts with an earlier document, this one wins. When this one is ambiguous, the supporting documents named in §0 fill in detail. When all of them are silent, the founder decides and the next revision captures the decision.

Next review trigger: shipping MVP Phase 3, or any major strategic event (acquisition offer, market shift, vendor terms change).
