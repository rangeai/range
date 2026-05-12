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

## 4. Competitive landscape

Range sits in a clear gap between three categories of existing tooling. Understanding the boundaries matters because it determines what we build, what we integrate with, and what we don't compete on.

### 4.1 The map

```
┌──────────────────────────────────────────────────────────────────────┐
│  WHERE RANGE LIVES                                                   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Agentic dev loop for robot sim                                │  │
│  │  · sessions · attempts · multi-seed verification               │  │
│  │  · evidence-backed PRs · cross-team handoff                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ADJACENT (we complement, don't replace)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐    │
│  │ Cursor /    │  │  Foxglove   │  │ W&B /       │  │ GitHub / │    │
│  │ VSCode      │  │             │  │ tensorboard │  │ Linear   │    │
│  │ (editor)    │  │ (data viz)  │  │ (metrics)   │  │ (tasks)  │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘    │
│                                                                      │
│  SUBSTRATE (we orchestrate, don't replace)                           │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌────────────┐    │
│  │  MuJoCo    │  │  ROS 2 +   │  │  Isaac Lab  │  │  Drake     │    │
│  │            │  │  Gazebo    │  │             │  │            │    │
│  └────────────┘  └────────────┘  └─────────────┘  └────────────┘    │
│                                                                      │
│  DIRECT COMPETITION (today's de-facto solution)                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Internal tools at every robotics company:                     │  │
│  │  hand-rolled bash scripts + spreadsheets + Slack threads       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Per-competitor read

**Cursor / VSCode / Claude Code (agentic IDEs)**
- *Where they're strong:* code editing, autocomplete, generic agent loops on a codebase
- *Where they're weak:* no robot-sim awareness, no verification primitives, no multi-seed eval semantics, no evidence model
- *Range's relationship:* complementary. We expect users to keep their editor. A Range VSCode/Cursor extension is on the Year-1 roadmap. The agentic loop in Range is *about* domain depth, not editor breadth.

**Foxglove (robotics data viz, ~$300M-ish valuation)**
- *Where they're strong:* multi-stream playback, time-aligned data viz, rosbag inspection, large robotics installed base
- *Where they're weak:* viewing, not iteration. No code, no agent, no PR. They sit at the *output* end of the loop, not the *driving* end.
- *Range's relationship:* adjacent / potentially partner. Their rosbag viz capability is excellent and we'd ingest their data model rather than rebuild it.

**Weights & Biases / TensorBoard (training metrics)**
- *Where they're strong:* training curves, experiment tracking, hyperparam sweeps
- *Where they're weak:* generic ML training; no understanding of robot scenarios, no PR integration, no verification gating
- *Range's relationship:* adjacent. A Range run's metric events should export to W&B if the user wants. We don't compete on training visualization.

**GitHub / Linear / Jira (code + task management)**
- *Where they're strong:* code review, issue tracking, PR workflows
- *Where they're weak:* generic; no verification primitives, no evidence model, no domain awareness
- *Range's relationship:* downstream integration. Range produces PRs to GitHub and updates tasks in Linear/Jira. We never replace these.

**Isaac Sim / Isaac Lab (NVIDIA sim platforms)**
- *Where they're strong:* deep simulation capability, RTX rendering, GPU acceleration
- *Where they're weak:* they're substrates, not dev tools. Users still need editors, eval harnesses, evidence trails.
- *Range's relationship:* supported user stack, not Range core dependency (per the positioning policy). Users who pick Isaac Lab can declare it in their profile.

**Hand-rolled internal tools (the real competition)**
- *Where they're strong:* tailored to one team's exact needs; team owns the code
- *Where they're weak:* costly to build (months of engineering per team), bus-factor-of-one, no shared evidence model across teams or companies, no inflow of community improvements
- *Range's relationship:* this is who we *displace*. Every robotics startup pays a 10-person-week tax on this every year. We offer the same workflow with no build cost and continual improvement.

### 4.3 Where Range wins

- **Domain depth** vs. Cursor's generic agent
- **Iteration ownership** vs. Foxglove's viewing-only stance
- **Robot-scenario awareness** vs. W&B's generic ML training framing
- **Verification primitives** vs. GitHub's "trust the developer" model
- **Out-of-the-box velocity** vs. building it yourself

### 4.4 Where Range doesn't compete (and shouldn't)

- We don't build an editor (Cursor wins)
- We don't build a simulator (MuJoCo/Gazebo win)
- We don't build a viz library (Foxglove wins)
- We don't build a training framework (PyTorch/JAX win)
- We don't build a task tracker (GitHub/Linear/Jira win)

---

## 5. Product

### 5.1 One-line

> Range is the agentic IDE for robot simulation — a workspace where an AI agent works alongside you on simulated robots, with structured evidence and verification baked into every PR.

### 5.2 The proving ground metaphor

Range is a **proving ground**: a place you take an attempt at solving a robot-sim problem before it becomes a commitment to ship. Multiple attempts can coexist. Each attempt produces evidence. The evidence becomes the PR.

The metaphor matters because it sets expectations:
- Attempts are cheap to spin up and cheap to discard
- An attempt is a hypothesis, not a commitment
- The artifact that leaves Range is *evidence* (a PR, a finding, a comparison), not a build

### 5.3 Design principles

Ten commitments that guide every product decision. When a feature request collides with one of these, the principle wins unless a clear, named exception is documented.

1. **Evidence first.** Everything Range does produces structured evidence. Logs are streams, not blobs. Metrics are events, not lines. Frames are checksummed, not summarized. A claim without evidence is not a claim.

2. **Composability over prescription.** Range provides the loop; users bring the stack. We don't dictate the simulator, training framework, or runner. The profile is the contract.

3. **Local-first, remote-aware.** Range runs entirely on the user's machine by default. Remote runners are a capability, not a requirement. Network access is opt-in.

4. **Vendor-neutral.** No required vendor dependencies. Any integration with vendor tech is via public surfaces only (see `range_positioning_v0_1.md`).

5. **Friction in the right places.** Cheap things stay cheap (creating sessions, opening attempts). Expensive things gate explicitly (remote GPU spend, pushing to remote, broad network access). Approval is discoverable, never silent.

6. **Conversation forward, structure behind.** The user interacts conversationally. Structured state (sessions, attempts, profiles, records) is maintained quietly. Users don't fill out forms — they talk and Range translates.

7. **Reproducibility as a feature, not a virtue.** Every run is reproducible from a single command. Reproducibility is enforced by the system, not by developer discipline.

8. **Agent as collaborator, not authority.** Codex narrates findings, makes proposals, drafts code. Codex never declares correctness; the system or human does.

9. **Failure is data.** When something breaks, evidence persists. The next attempt can read what failed before. No "rerun from scratch" mentality.

10. **Trust transfers, not just code.** A PR from Range carries the evidence its reviewer needs to trust without re-running. The unit of work shared is "evidence + diff," not just "diff."

### 5.4 What Range is

- An agentic workspace for robot simulation work
- A session/attempt/run/evidence model with first-class verification
- A profile-driven harness — users bring their stack via `range.yaml`
- A local-first product that scales to remote runners (GPU clusters, SSH hosts)
- An open, MIT-licensed, vendor-neutral platform

### 5.5 What Range is not

- Not a code editor — we don't compete with Cursor / VSCode
- Not a simulator — we orchestrate MuJoCo / Gazebo / Drake / Isaac Lab / custom
- Not a data viz tool — Foxglove owns that surface; we complement it
- Not a fleet manager or hardware-deployment tool *yet* (future expansion)
- Not a closed or vendor-bound ecosystem

---

## 6. Core concepts

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

### 6.1 Verification record — concrete shape

A verification record is the structured judgment Range produces when an attempt's verification commands complete. It's the entity that gates PR push and gets serialized into the PR body. Below is a real-shape example for a passing multi-seed eval:

```json
{
  "id": "ver_3kf9q2",
  "attempt_id": "att_codex_fix_minimal",
  "session_id": "ssn_mp2wdpmuql2uqj",
  "status": "passed",
  "kind": "multi_seed",
  "created_at": "2026-05-12T17:21:28Z",
  "completed_at": "2026-05-12T17:24:12Z",
  "scenario": "warehouse_a",
  "n_seeds": 5,
  "checks": [
    {
      "name": "success_rate",
      "kind": "metric_threshold",
      "predicate": ">=0.92",
      "aggregate": "mean_across_seeds",
      "observed": {
        "value": 0.94,
        "stddev": 0.02,
        "n_seeds": 5,
        "per_seed": [
          {"seed": 42, "value": 0.96},
          {"seed": 43, "value": 0.93},
          {"seed": 44, "value": 0.94},
          {"seed": 45, "value": 0.91},
          {"seed": 46, "value": 0.96}
        ]
      },
      "status": "passed"
    },
    {
      "name": "collisions",
      "kind": "metric_threshold",
      "predicate": "==0",
      "aggregate": "sum_across_seeds",
      "observed": { "value": 0, "n_seeds": 5 },
      "status": "passed"
    },
    {
      "name": "video_artifact_present",
      "kind": "artifact_exists",
      "predicate": "runs/${run_id}/replay.mp4",
      "status": "passed",
      "artifact_refs": ["run_a3:replay.mp4", "..."]
    },
    {
      "name": "diff_scope",
      "kind": "diff_scope",
      "predicate": "src/nav/",
      "observed": { "files_changed": 2, "all_inside_scope": true },
      "status": "passed"
    }
  ],
  "runs": ["run_a1", "run_a2", "run_a3", "run_a4", "run_a5"],
  "overrides": [],
  "concerns_pinned": []
}
```

The `status` field is one of `passed` · `passed-with-concerns` · `failed` · `overridden`. `passed-with-concerns` is a first-class state, not a footnote. An `override` carries a logged reason and signer.

---

## 7. User stories

Twelve stories spanning the canonical loop. Each: `As a [persona], I want [capability] so that [outcome]`, plus acceptance criteria.

### 7.1 Bring work into Range

**As a** robot ML engineer
**I want to** start a session from a Jira task, a freeform description, or a PR URL
**So that** my entry point matches the shape of work I have

**Acceptance:**
- Composer accepts: tracker ID (`SIM-1842`), URL, freeform text
- Range proposes the matching session kind and profile
- Nothing irreversible (worktree, GPU spend) happens before I confirm
- For PRs, Range fetches the branch and enters verification mode

### 7.2 Reproduce a known failure

**As a** robot ML engineer
**I want** Range to spin up a baseline attempt and run the profile's reproduce command
**So that** I have ground-truth evidence the bug exists before any change is contemplated

**Acceptance:**
- A `baseline-main` attempt is created from a recorded base SHA
- Logs, metrics, frames, video stream live into the evidence panel
- Result is labeled clearly: *reproduced / not reproduced / partially reproduced* (latter for statistical tasks)
- Expensive runs (remote GPU) prompt for confirmation with cost estimate
- All evidence is checksum-pinned and linked to the attempt

### 7.3 Investigate with Codex in read-only mode

**As a** robot ML engineer
**I want to** send Codex into the repo with no write access and see its reasoning
**So that** it forms hypotheses without making unauthorized changes

**Acceptance:**
- Sandbox is `read-only`; writes are blocked at the agent level
- I can steer Codex conversationally ("focus on the planner module, ignore the data loader")
- Codex's command activity streams live with structured events (`item/started` → `item/completed`)
- Hypotheses surface as structured artifacts, each linked to the evidence it rests on

### 7.4 Implement a fix with guardrails

**As a** robot ML engineer
**I want to** declare constraints conversationally before Codex acts
**So that** Codex stays inside the bounds I trust

**Acceptance:**
- Constraints expressed in natural language ("don't touch the planner API, only modify the reward function, no scenario config changes")
- Range translates to a structured guardrail set visible in the attempt header
- Guardrail violations trigger an approval gate, not silent block
- Guardrails appear in the eventual PR's evidence section

### 7.5 Run parallel attempts

**As a** robot ML engineer
**I want to** spin up two implementation attempts from the same base
**So that** I can compare two real diffs instead of arguing about hypotheticals

**Acceptance:**
- Each attempt has its own worktree and Codex thread
- Both stay live and switchable; evidence panel reflects the active attempt
- One-writer-per-worktree enforced
- Compare-attempts view shows diff, runs, and verification side-by-side

### 7.6 Multi-seed verify a candidate

**As a** robot ML engineer
**I want** the verification command to run across N seeds by default
**So that** I never ship a fix based on one lucky seed

**Acceptance:**
- N from profile (default 5)
- Per-seed evidence preserved; results not silently averaged
- Aggregate result: pass rate, metric distribution, outliers flagged
- Verification record reflects statistical shape, not a single number

### 7.7 Catch "looks wrong" even when "passes the metric"

**As a** simulation developer
**I want to** scrub trajectory videos and pin step ranges as concerns
**So that** a visually broken run doesn't ship just because the metric passed

**Acceptance:**
- Episode replay player synchronizes video, trajectory plot, reward curve, action stream
- Side-by-side comparison against baseline
- A pinned concern attaches to the verification record as `passed-with-concerns`
- Codex describes visible differences but never declares them authoritative

### 7.8 Cross-layer debugging

**As a** simulation platform developer
**I want to** pin the version of an upstream dependency and re-run to isolate cause
**So that** I can tell if a bug is in my code or underneath it

**Acceptance:**
- A profile can declare dependency pins
- Range can spawn an attempt with a custom pin (e.g., MuJoCo 3.4 instead of 3.5)
- Comparing pinned attempts shows which version exhibits the bug
- The bisect-style result becomes evidence for the upstream filing

### 7.9 Hand off across team boundaries

**As a** simulation platform developer
**I want to** file a downstream-found bug back to the upstream team with full evidence
**So that** they don't have to re-derive what I just found

**Acceptance:**
- "File back" generates a structured ticket in the target tracker
- Ticket includes reproduction, bisect evidence, repro script, all linked artifacts
- Source-side ticket is automatically marked `upstream-pending`
- Upstream-pending status is reflected when the target ticket changes

### 7.10 Ship an evidence-backed PR

**As a** robot ML engineer
**I want** Range to draft a PR body from the verification record, attempt history, and diff
**So that** the evidence section is structurally complete by default

**Acceptance:**
- Body has a structured backbone (verification record, files changed, metric deltas, artifact links, reproduction command, guardrails) that's template-rendered from data and not editable as text
- Narrative sections (summary, motivation, known risks) are Codex-drafted, developer-editable
- Reproduction command is exact and runnable, pinned to commit SHA + runner profile
- Push is an explicit action, never silent

### 7.11 Verify someone else's PR

**As a** tech lead
**I want to** drop a PR URL into Range and have it run the full verification suite
**So that** I can review with confidence the author's claims hold

**Acceptance:**
- PR-verification session checks out the head SHA
- Codex is read-only; only verification commands run
- Cleanroom verification available with one request
- Findings can be posted as a PR comment (with my approval)

### 7.12 Resume yesterday's work

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

## 8. UX overview

### 8.1 Information architecture

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

### 8.2 The Home surface

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

### 8.3 The Live Session surface

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
│    log       │   3 matches in 1 file               │    pending         │
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

### 8.4 The Episode Viewer (post-run drill-in)

When a run completes, clicking it opens the episode viewer — a time-aligned multi-stream playback that lets the developer review what actually happened. This is the most demo-worthy surface in the product.

```
┌────────────────────────────────────────────────────────────────────────┐
│ codex-fix-minimal › run_a3 · warehouse_a · seed 44 · 12.3s · ✓ passed │
├────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐  │
│ │                                                                  │  │
│ │           [rendered viewport video — scrubbable]                 │  │
│ │                                                                  │  │
│ │                          ● step 1207 / 1500                      │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│  [◀◀] [◀] [▶] [▶▶]  ●━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●     │
│   0:00            scrub                                         0:12  │
├────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│ │ Trajectory      │  │ Reward / metrics     │  │ Sensor sample    │  │
│ │ (top-down)      │  │ success_rate: 0.94   │  │ depth · t=1207   │  │
│ │   [grid]        │  │ reward  ━━━━━╱━━━━   │  │  [depth frame    │  │
│ │     ◉ start     │  │ collide ━━━━━━━━━━   │  │   rendered]      │  │
│ │      ╲          │  │ jerk    ━━╱╲━━━━━━   │  │                  │  │
│ │       ╲    ◯    │  │                      │  │ camera_front     │  │
│ │       step 1207 │  │ [pin step range as   │  │  [rgb frame]     │  │
│ │        ▼ goal   │  │  concern]            │  │                  │  │
│ └─────────────────┘  └──────────────────────┘  └──────────────────┘  │
│                                                                        │
│ Compare to: [baseline-main · run_b3 ▾]  [overlay ▾]  [side-by-side ▾]│
└────────────────────────────────────────────────────────────────────────┘
```

Behavior:
- All four panes (video, trajectory, metrics, sensor) scrub together on the timeline
- Click any point on a metric line → snap the rest of the panes to that timestep
- Pin a step range → adds a `concerns_pinned` entry to the verification record
- Compare-to dropdown → flip to the comparison view (next section)
- Codex can be asked "describe what's happening at step 1207" — narration only, never authoritative

### 8.5 The Comparison View (two attempts side by side)

When the developer wants to see the difference two attempts make on the same scenario.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Compare: baseline-main  vs  codex-fix-minimal      ⊕ add third  ✕     │
├─────────────────────────────────┬───────────────────────────────────────┤
│  baseline-main                  │  codex-fix-minimal                    │
│  warehouse_a · 5 seeds          │  warehouse_a · 5 seeds                │
│                                 │                                       │
│  success_rate   0.62 ± 0.08     │  success_rate   0.94 ± 0.02   +0.32 ↑│
│  collisions     0.4  ± 0.5      │  collisions     0.0           −0.4 ↓ │
│  time_to_goal   14.2s ± 1.8     │  time_to_goal   11.9s ± 0.8   −2.3 ↓ │
│                                 │                                       │
│  ┌──── replay · seed 44 ─────┐  │  ┌──── replay · seed 44 ─────┐       │
│  │                            │  │  │                            │       │
│  │   [video, t=12.3]          │  │  │   [video, t=11.9]          │       │
│  │                            │  │  │                            │       │
│  └────────────────────────────┘  │  └────────────────────────────┘       │
│  [◀ ◀ ▶ ▶] sync scrub: on       │  [◀ ◀ ▶ ▶]                            │
│                                 │                                       │
│  per-seed [42][43][44*][45][46] │  per-seed [42][43][44][45][46]       │
│  * outlier — 0.34 success       │  no outliers                          │
│                                 │                                       │
│  [open run] [open attempt]      │  [open run] [open attempt]            │
└─────────────────────────────────┴───────────────────────────────────────┘
                                                                          │
                       [save as comparison report] [export to PR body]    │
```

Sync-scrub means dragging the timeline on either side scrubs the other. Per-seed dots reveal outliers at a glance. "Save as comparison report" produces a portable artifact that can attach to the PR.

### 8.6 The Plan surface

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

### 8.7 The Freeform Session surface

For when work doesn't have a tracker entry yet. Same shape as a tracked-task session, but with a `freeform` indicator, an "inferred context" panel, and a "promote to tracked task" affordance. See `mockups/mockup-session-freeform.html` for the high-fidelity reference.

### 8.8 Auth & onboarding surface

Two-step: sign in (GitHub OAuth), then connect optional services (Jira via API token, Slack optional). None of it gates getting to work — Range works with just GitHub connected. See `mockups/mockup-auth.html`.

### 8.9 Theme system

Range ships with both dark (default) and light themes. Phosphor-yellow accent for "live" states (CRT phosphor reference). Toggle in every top bar, preference persisted in `localStorage`, first-launch reads `prefers-color-scheme`.

Typography: Bricolage Grotesque (display), Geist (UI), JetBrains Mono (data/code). Color palette uses `oklch()` for perceptually uniform shifts between modes.

---

## 9. Technical architecture

### 9.1 Components

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

### 9.2 Stack

**Frontend:** React 19, Vite, Tailwind v4, Zustand for high-frequency state, `@tanstack/react-virtual` for long lists, `useSyncExternalStore` for the WebSocket subscription (avoids unnecessary re-renders).

**Backend:** Bun (the runtime), Hono (the HTTP/WebSocket framework). Why Bun: native WebSocket, `bun:sqlite` (fastest JS SQLite binding), no transpile step for TypeScript, fast cold start. Why Hono: minimal, fast, native Bun WebSocket support, well-typed.

**Storage:** SQLite via `bun:sqlite`, in WAL mode, foreign keys on. Schema applied via idempotent migrations on boot. Default location: `~/.range/range.db` (override via `RANGE_DB` env).

**Agent integration:** OpenAI Codex via `codex app-server` subprocess + JSON-RPC 2.0 newline-delimited over stdio. Modeled directly on Companion's `codex-adapter.ts` (MIT). Persistent thread per attempt; resume via `thread/resume`. WebSocket transport for Codex is feature-flag P1.

**Auth:** Local token at `~/.range/auth.json`, auto-generated on first start. Web/mobile WebSocket clients connect with the token as a query param. Designed for local-first multi-machine reach via Tailscale, not multi-tenant SaaS.

**Build / packaging:** Distributed as an npm package, runnable via `bunx the-range` (subject to availability of the name). Single-binary distribution post-MVP.

### 9.3 Data model

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

### 9.4 State machines

Each first-class entity has a defined state machine. Invalid transitions are blocked at the domain layer and logged.

**Session lifecycle:**

```
   created ──→ active ⇄ parked ──→ archived
                  │
                  └──→ resolved (terminal when linked to a merged PR)
```

**Attempt lifecycle:**

```
   created
      │
      ▼
   context_ready
      │
      ▼
   worktree_ready
      │
      ▼
   agent_running ⇄ waiting_for_user
      │              │
      └──→ running_command ⇄ paused
              │
              ▼
        verification_pending
              │
       ┌──────┴──────┐
       ▼             ▼
   passed       failed
       │             │
       ▼             └──→ (back to agent_running, or discarded)
   review_ready
       │
       ▼
   pr_opened
       │
       ▼
   archived
```

**Run lifecycle:**

```
   queued ──→ starting ──→ running ⇄ paused
                  │           │
                  ▼           ├──→ succeeded
              failed_start    ├──→ failed
                              ├──→ aborted
                              │
                              ▼
                         archived (after configurable retention)
```

These are enforced by a `SessionStateMachine` class (and equivalents for Attempt and Run) borrowed in shape from Companion's `session-state-machine.ts`.

### 9.5 Wire protocol

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

### 9.6 Codex integration

Per `companion_learnings_v0_1.md`, we use the same path Companion uses for Codex:

1. Server spawns `codex app-server` with the attempt's worktree as `cwd`
2. Server sends `initialize` → server receives capabilities
3. Server sends `initialized` → handshake complete
4. Server sends `thread/start` (or `thread/resume`) with model, approvalPolicy, sandbox
5. Codex emits notifications: `item/started`, `item/updated`, `item/completed`
6. Codex emits requests: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`
7. Server translates Codex items into Range's browser event protocol via the adapter

Adapter is the most complex single component. Plan to vendor Companion's adapter pattern with MIT attribution and adapt to Range-specific event names.

### 9.7 Runner model

Two runner kinds in MVP:

**Local runner.** Spawns child processes on the host machine. Watches declared artifact globs via `chokidar` (or Bun's `fs.watch`). Streams stdout/stderr line-by-line to the WS bus. Suitable for fast iteration on a Mac during development.

**SSH-backed remote runner.** Manages a long-lived SSH connection to a Linux host (GPU box). Uses rsync to sync the worktree, then runs commands remotely, streams output back, retrieves artifacts. Suitable for training runs and multi-seed eval.

Both runners share a common interface: `runCommand(command, profile, cwd) → Stream<RunEvent>`. Adding a third runner kind (container, Kubernetes) is a future addition that doesn't change the interface.

### 9.8 Performance budget

Concrete numbers Range commits to in the MVP:

| Metric | Budget |
|---|---|
| Cold start (`bunx range`) | < 2s to ready |
| WebSocket round-trip latency | p50 < 10ms, p99 < 50ms (loopback) |
| Codex event → UI display | < 100ms end-to-end |
| SQLite query for session list | < 10ms |
| Frame thumbnail render | < 50ms |
| Session creation API | < 100ms |
| Concurrent active sessions | up to 10 with no perceived degradation |
| Memory resident (typical) | < 500MB |
| Memory resident (heavy eval) | < 2GB |
| Disk per session (worktree + evidence) | < 500MB typical, configurable cap |

These are budgets, not aspirations. CI surfaces violations.

### 9.9 Failure handling philosophy

Six principles for how Range behaves under failure. The point is **failure is data**, not silent loss.

1. **Codex disconnects.** Session pauses in `agent_running → reconnecting`. Last good state preserved. On resume, attempt to reconnect via `thread/resume` first; if that fails, surface clearly that the thread is lost and offer to start fresh with the prior context pack as input.

2. **Runner dies mid-run.** Run is marked `failed` with `partial_evidence: true`. Everything captured up to the point of failure is preserved and labeled. The next attempt can read what failed before.

3. **Profile invalid.** Reject at session creation, before any side effects (no worktree, no GPU spend). Error message is concrete: which key is wrong, on which line.

4. **Network split (remote runner).** Buffer output locally on the runner side, retry transmission with exponential backoff, surface clearly to the user that buffering is happening. Never drop evidence silently.

5. **Disk full.** Fail loudly. Refuse to truncate evidence. Surface the disk-usage forecast in the lifecycle UI so users see it coming.

6. **Codex makes a bad edit.** Range never reverts edits silently. The diff stays in the worktree until the user explicitly discards or commits. The user can undo individual edits granularly.

---

## 10. Target stacks + plugin model

### 10.1 Officially supported in MVP

**MuJoCo (Apache 2.0)** — primary, where the agentic wedge lands hardest. Yard ships as the canonical MuJoCo demo project.

**ROS 2 + Gazebo (Apache 2.0)** — secondary, the production-robotics standard. A turtlebot navigation scene ships as the canonical Gazebo demo.

Both run natively on macOS Apple Silicon as of 2026 (see `range_sim_stack_support_v0_1.md`), so development against either stack is unblocked on a Mac dev machine — no remote-runner gating.

### 10.2 Pluggable later

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

### 10.3 Sample `range.yaml` — MuJoCo (Yard profile)

This is the actual profile shape Yard ships with. Every Range concept (scenarios, runs, metrics, verification, approvals) maps to a section.

```yaml
# range.yaml — Yard project profile
version: 1

project:
  name: yard
  description: "Minimum viable robotics sim for dogfooding Range"
  stack: mujoco
  language: python

runners:
  - name: local
    kind: local
    default: true
  - name: rg-h100-12
    kind: ssh
    host: rg-h100-12.example.com
    user: dhavalp
    workdir: ~/range-runs
    gpu_hours_per_run_max: 2
    cost_estimate_per_hour: 2.50

scenarios:
  - name: warehouse_a
    description: "warehouse navigation, dense obstacles, seed-stable"
    artifacts:
      logs: runs/${run_id}/*.log
      metrics: runs/${run_id}/metrics.json
      frames: runs/${run_id}/depth_frames/*.png
      video: runs/${run_id}/replay.mp4
      trajectory: runs/${run_id}/trajectory.npz
  - name: warehouse_b
    description: "warehouse navigation, sparse obstacles"
    artifacts:
      logs: runs/${run_id}/*.log
      metrics: runs/${run_id}/metrics.json

commands:
  setup:
    - python -m pip install -e .
  reproduce:
    args: ["yard", "run", "--scenario", "${scenario}", "--seed", "${seed}"]
    default_seed: 42
  evaluate:
    args: ["yard", "eval", "--scenario", "${scenario}", "--seeds", "${seeds}"]
    default_seeds: 5
  verify:
    args: ["yard", "regress", "--suite", "default"]

metrics:
  success_rate:
    source: runs/${run_id}/metrics.json
    path: $.success_rate
    threshold: ">=0.8"
    aggregate: mean_across_seeds
  collisions:
    source: runs/${run_id}/metrics.json
    path: $.collision_count
    threshold: "==0"
  time_to_goal_ms:
    source: runs/${run_id}/metrics.json
    path: $.time_to_goal_ms
    threshold: "<=15000"
    aggregate: median_across_seeds

verification:
  default_seeds: 5
  pass_criteria:
    - metric: success_rate
    - metric: collisions
    - artifact_exists: runs/${run_id}/replay.mp4
    - diff_scope: src/
  warn_criteria:
    - metric: time_to_goal_ms   # warn, do not fail

approvals:
  remote_runner_cost_estimate_gt: 5.00
  network_egress_allowlist:
    - github.com
    - api.openai.com
```

### 10.4 Sample `range.yaml` — ROS 2 + Gazebo (turtlebot demo)

```yaml
# range.yaml — turtlebot navigation demo profile
version: 1

project:
  name: turtlebot-nav-demo
  description: "Turtlebot navigation in Gazebo, demonstrating ROS 2 stack"
  stack: ros2
  language: python

runners:
  - name: local
    kind: local
    default: true
    # Mac users: install via IOES-Lab ROS 2 Kilted installer; no remote needed

scenarios:
  - name: empty_world
    description: "Turtlebot in an empty world, baseline behavior"
    artifacts:
      bag_files: bags/${run_id}/*.mcap
      metrics:   bags/${run_id}/metrics.json
      video:     bags/${run_id}/replay.mp4
  - name: obstacles_v1
    description: "Turtlebot navigation around obstacles"
    artifacts:
      bag_files: bags/${run_id}/*.mcap
      metrics:   bags/${run_id}/metrics.json
      video:     bags/${run_id}/replay.mp4

commands:
  setup:
    - colcon build --packages-select turtlebot_nav_demo
  reproduce:
    args: ["ros2", "launch", "turtlebot_nav_demo", "demo.launch.py",
           "scenario:=${scenario}", "seed:=${seed}"]
    default_seed: 42
  evaluate:
    args: ["python", "scripts/eval.py",
           "--scenario", "${scenario}", "--seeds", "${seeds}"]
    default_seeds: 3
  verify:
    args: ["python", "scripts/regress.py"]

metrics:
  reach_goal:
    source: bags/${run_id}/metrics.json
    path: $.reach_goal_rate
    threshold: ">=0.9"
    aggregate: mean_across_seeds
  min_clearance_m:
    source: bags/${run_id}/metrics.json
    path: $.min_obstacle_clearance_m
    threshold: ">=0.2"
    aggregate: min_across_seeds
  cmd_vel_smoothness:
    source: bags/${run_id}/metrics.json
    path: $.cmd_vel_jerk_rms
    threshold: "<=0.5"

verification:
  default_seeds: 3
  pass_criteria:
    - metric: reach_goal
    - metric: min_clearance_m
    - artifact_exists: bags/${run_id}/replay.mp4
  warn_criteria:
    - metric: cmd_vel_smoothness
```

The two profiles share the same schema. A user moving between stacks doesn't relearn Range — they relearn their commands.

### 10.5 What "officially supported" means

For each top-2 stack, MVP ships:

- A known-good `range.yaml` template (above)
- A 15-minute quickstart guide
- An evidence parser tuned for the stack's log format
- One canonical demo scenario

### 10.6 What we explicitly don't anchor on

Per `range_positioning_v0_1.md`:

- Isaac Sim / Isaac Lab — supported as *user stacks* only. We do not take a dependency on them. Users can declare them in their `range.yaml`; Range orchestrates them like any other Python dep.
- Omniverse Kit — forbidden as a Range core dependency.
- Anything requiring NDA / non-public NVIDIA APIs.

---

## 11. Roadmap

### 11.1 MVP — Phase 1 to Phase 3 (8-10 weeks part-time)

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
- ⏳ ROS 2 + Gazebo demo profile (Mac-native via IOES-Lab installer)

**Phase 3: Remote + cross-layer (3-4 weeks)**
- ⏳ SSH remote runner: worktree sync, command exec, artifact retrieval
- ⏳ Multi-seed eval orchestration (MuJoCo)
- ⏳ Cross-layer evidence handoff (file back to upstream tracker)
- ⏳ Episode viewer (the most demo-worthy feature)

### 11.2 First-15-minutes onboarding (target experience)

The MVP succeeds when a new user can go from `bunx the-range` to a shipped evidence-backed PR in 15 minutes. Here is the target sequence:

```
t=0      User runs `bunx the-range`
         Server boots, browser opens to home.
         "What are we working on, today?" composer is focused.

t=10s    User types a freeform description or pastes a GitHub/Jira URL.

t=30s    Session is created. Session view opens.
         Empty state: "No attempt yet — create baseline?"

t=1m     User clicks "create baseline attempt."
         Worktree created in `~/.range/wt/...`.
         Codex starts in read-only sandbox.
         Sees Codex's reasoning stream in real time.

t=3m     Codex finishes initial investigation.
         User reads the structured hypothesis card on the right.

t=4m     User clicks "promote to implementation."
         New attempt created, workspace-write sandbox.
         Codex starts making changes; user sees file edits stream.

t=8m     Codex finishes implementation.
         User clicks "verify."
         Multi-seed eval (5 seeds, local) starts.
         Evidence streams in: logs, metrics, frames, video.

t=13m    Verification record posts. Status: passed.
         User reviews PR draft (already populated).
         Clicks "open PR with evidence."
         PR opens on GitHub with structured body.

t=15m    First evidence-backed PR shipped.
         Total cost: $0 (all local) or ~$0.10 (a few Codex API calls).
```

This sequence is the activation funnel we instrument against.

### 11.3 Year 1 (post-MVP)

- Episode replay player (sketched above; ships fully in Year 1)
- Multi-runner orchestration (parallel attempts on different GPUs)
- Drake support
- Better cleanroom verification (containerized reruns)
- VSCode/Cursor extension that surfaces Range sessions from the editor
- Real-robot telemetry ingestion (rosbag → evidence)

### 11.4 Year 2+

- Real-hardware deployment connector (push policy to robot, monitor)
- Fleet view (multiple robots in the field)
- Linear / GitLab / internal tracker integrations
- Team policies / audit / governance
- Cloud-hosted multi-user version (current MVP is local-first)

### 11.5 The north star

By 2028, Range is the unified workspace for the loop from sim through deployment for the robotics industry. Each year's roadmap earns the next year's expansion.

---

## 12. Success metrics

### 12.1 Activation (week 1 of a new user)

- Time from first launch to first session created (target: < 30 seconds)
- Time from first session to first run completing (target: < 5 minutes)
- Time from first session to first evidence-backed PR drafted (target: < 30 minutes for the canonical MuJoCo path)
- % of new users who reach a shipped PR in week 1 (target: > 50%)

### 12.2 Engagement (steady state)

- Sessions per developer per week (target: 5+)
- Attempts per session (target: 1.5-3, indicating real iteration without sprawl)
- % of weekly sessions that culminate in a PR (target: 60%+ for tracked-task sessions)
- WAU / MAU ratio (target: > 50%)

### 12.3 Wedge metrics

- % of PRs produced through Range that have a complete evidence package (target: 80%+)
- % of verification records that *gate* a PR push (target: high — the gate is doing its job)
- Reviewer acceptance rate for Range PRs vs. team average (target: equal or better)

### 12.4 Trust signals

- Multi-seed eval as default behavior, not opt-in
- Approval-gate denial rate (low rate suggests gates are well-tuned; high rate suggests over-gating)
- Reproduce-from-PR success rate (target: 95%+)

---

## 13. Non-goals & risks

### 13.1 Non-goals (deliberately not building)

- A code editor (Cursor / VSCode own this)
- A simulator (MuJoCo / Gazebo / Drake own this)
- A data viz tool (Foxglove owns this; we may integrate)
- A model training framework (PyTorch / JAX own this)
- A fleet manager (future expansion, not MVP)
- A SaaS multi-tenant version in MVP (local-first; multi-tenant comes when economics demand it)
- Mobile UI in MVP (Companion has one; we don't need it)
- A general-purpose dev tool — we are domain-deep, not domain-shallow

### 13.2 Risks

- **Cursor adds robot-sim awareness.** Mitigation: deeper domain depth, evidence model, multi-runner orchestration are non-trivial to clone. Build moat through specificity.
- **Foxglove adds an agentic layer.** Mitigation: they're viz-first, we're loop-first. Different surface. Could be partner more than competitor.
- **MuJoCo community fragments.** Mitigation: support multiple stacks (top-2 design), profile-driven means we absorb fragmentation as plugin work.
- **NVIDIA builds a competing dev tool.** Mitigation: per the Kit-disaggregation update, NVIDIA's direction is library-first, not tool-first. Our vendor-neutral positioning is complementary.
- **Codex pricing or terms shift.** Mitigation: `CodexAdapter` interface allows future adapter swaps (Claude Code, Gemini-CLI). Single-vendor agent dependence is a known risk to manage, not eliminate.
- **MVP scope creeps.** Mitigation: paired phases with Yard force discipline; each phase has explicit exit criteria.
- **First user research never happens.** Mitigation: the founder is at NVIDIA with privileged access to real Isaac Lab / sim users. Schedule conversations early, not after MVP ships.

### 13.3 Open questions

These don't block MVP but should be resolved before public launch:

- Pricing model (per-seat? per-org? free for individuals?)
- License of Range itself (currently MIT — confirm before commercial launch)
- Cloud-hosted vs. local-only as the marketed default
- Telemetry (do we collect anonymous usage data? what's our policy?)
- Brand identity beyond the wordmark (logo, color system extensions, motion language)

---

## 14. Authority

This PRD is the canonical product reference. When it conflicts with an earlier document, this one wins. When this one is ambiguous, the supporting documents named in §0 fill in detail. When all of them are silent, the founder decides and the next revision captures the decision.

Next review trigger: shipping MVP Phase 3, or any major strategic event (acquisition offer, market shift, vendor terms change).

---

## Appendix A. Persona vignettes (condensed)

Three condensed personas tied to specific real public stacks. Full versions in `docs/range_scenarios_v0_1.md`.

**Priya — ovrtx core developer.** Maintains sensor sim at NVIDIA. Day: triage customer bug reports, ship fixes, review PRs. Range scenario: customer sends a USD scene + lidar config, Priya reproduces on H100 + Ada, ships a fix with a customer-facing summary in 25 minutes.

**Anika — Isaac Lab developer.** Maintains Isaac Lab's sensor abstractions. Day: handle user-reported issues that often cross her wrapper into ovrtx. Range scenario: user reports depth noise in Lab 2.6 vs 2.5; Anika bisects across versions and a pinned upstream dependency, identifies it as an ovrtx regression (not her wrapper), files an evidence-backed upstream ticket.

**Karthik — AV sensor-sim engineer.** Builds proprietary synthetic data pipeline on ovrtx. Day: defend his work against blame from the perception team's regressions. Range scenario: perception team flags 3% mAP drop; Karthik re-verifies his old PR with their new eval dataset, proves his change wasn't the cause, shares the evidence record with the perception team.

---

## Appendix B. Companion borrowing summary

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

---

## Appendix C. Mockup reference

Six self-contained HTML mockups serve as authoritative visual references:

- `mockups/mockup-index.html` — launcher
- `mockups/mockup-auth.html` — connect GitHub / Jira / Slack
- `mockups/mockup-home.html` — composer + recent sessions
- `mockups/mockup-plan.html` — all PRs
- `mockups/mockup-session-freeform.html` — freeform session in shaping
- `mockups/mockup-implementation.html` — live Codex session with evidence

Each has dark/light theme support and renders without a build step.

---

## Appendix D. Yard — the dogfood sim

A deliberately minimal robotics simulator built on MuJoCo + USD + Python that Range uses to dogfood itself. One robot, one warehouse scene, one depth camera, one navigation task, multi-seed eval. Codebase capped at 2,000 lines as a forcing function. Full spec in `yard_product_spec_v0_1.md`.

Yard is not the product. Range is. Yard exists so Range stays honest.

---

## Appendix E. Sample evidence-backed PR (full body)

This is what Range produces at the end of a successful session. The structured sections are template-rendered from the verification record and run data — they are not editable as free text. The narrative section (Summary, Known risks) is Codex-drafted and developer-editable.

```markdown
# Fix replay buffer ordering in warehouse_dense_v3 navigation

## Summary
Fixes a frame-ordering bug in `_advance_pointer` that caused stale
obstacle state during warehouse_dense_v3 rollouts. The pointer was
advancing before the timestamp was stamped onto the frame, causing
consumers to read a frame labeled with the next pointer's timestamp.

## Task
- Source:     SIM-1842
- Repo:       robot-nav-sim
- Base:       main@abc123def
- Session:    ssn_mp2wdpmuql2uqj
- Candidate:  codex-fix-minimal

## Files changed
- src/nav/replay_buffer.py            (+12 / -2)
- tests/nav/test_replay_buffer.py     (+38 / new file)

## Guardrails respected
- ✓ scope: src/nav/ only
- ✓ no planner public API changes
- ✓ ≤2GB GPU per run

## Verification — status: passed

All checks across 5 seeds.

| Check                    | Threshold     | Result                   |
|--------------------------|---------------|--------------------------|
| success_rate             | ≥ 0.92        | 0.94 ± 0.02 (n=5)        |
| collision_count          | = 0           | 0 across all seeds       |
| time_to_goal_ms          | ≤ 15000       | 11890 median             |
| diff scope (src/nav/)    | satisfied     | passed                   |
| Cleanroom verification   | passed        | re-applied to base SHA   |

## Metric deltas (vs. baseline-main)

| Metric          | Baseline (n=5)  | Candidate (n=5)  | Δ        |
|-----------------|-----------------|------------------|----------|
| success_rate    | 0.62 ± 0.08     | 0.94 ± 0.02      | +0.32 ↑  |
| collisions      | 0.4  ± 0.5      | 0.0              | -0.4  ↓  |
| time_to_goal_ms | 14200 ± 1800    | 11890 ± 800      | -2310 ↓  |

## Evidence
- Trajectory video (candidate): runs/SIM-1842/codex-fix-minimal/warehouse_a_seed42.mp4
- Depth frame sequence:         runs/SIM-1842/codex-fix-minimal/depth_frames/
- Per-seed metrics:             runs/SIM-1842/codex-fix-minimal/per_seed/
- Baseline trajectory:          runs/SIM-1842/baseline-main/warehouse_a_seed42.mp4
- Verification record:          range://verifications/ver_3kf9q2

## Reproduce
```bash
range verify --session ssn_mp2wdpmuql2uqj \
             --attempt codex-fix-minimal \
             --clean
```

This will check out the candidate commit, apply the cleanroom verification
flow, and produce the same metric outcomes within statistical variance.

## Known risks
- Only validated on warehouse_dense_v3 and seeds 42–46. Behavior on other
  scenarios was not verified in this session.
- The frame-timestamp invariant was previously implicit; this PR makes it
  explicit via a unit test. If other code paths rely on the old ordering,
  they may need updating.

---
Generated by Range v0.1.0 · Codex (gpt-5 via codex app-server) ·
session ssn_mp2wdpmuql2uqj · 2026-05-12T17:24:12Z
```

The reviewer's job changes shape with a PR like this. They are not re-verifying claims; they are reviewing **reasoning** and **risk** while trusting the structured evidence.

---

## Appendix F. Sample verification record (full JSON)

The on-disk shape of the verification record referenced in §6.1 and serialized into the PR template in Appendix E.

```json
{
  "id": "ver_3kf9q2",
  "attempt_id": "att_codex_fix_minimal",
  "session_id": "ssn_mp2wdpmuql2uqj",
  "status": "passed",
  "kind": "multi_seed",
  "scenario": "warehouse_a",
  "created_at": "2026-05-12T17:21:28Z",
  "completed_at": "2026-05-12T17:24:12Z",
  "n_seeds": 5,
  "runner": "local",
  "checks": [
    {
      "name": "success_rate",
      "kind": "metric_threshold",
      "predicate": ">=0.92",
      "aggregate": "mean_across_seeds",
      "observed": {
        "value": 0.94,
        "stddev": 0.02,
        "n_seeds": 5,
        "per_seed": [
          {"seed": 42, "value": 0.96, "run_id": "run_a1"},
          {"seed": 43, "value": 0.93, "run_id": "run_a2"},
          {"seed": 44, "value": 0.94, "run_id": "run_a3"},
          {"seed": 45, "value": 0.91, "run_id": "run_a4"},
          {"seed": 46, "value": 0.96, "run_id": "run_a5"}
        ]
      },
      "status": "passed"
    },
    {
      "name": "collisions",
      "kind": "metric_threshold",
      "predicate": "==0",
      "aggregate": "sum_across_seeds",
      "observed": { "value": 0, "n_seeds": 5 },
      "status": "passed"
    },
    {
      "name": "time_to_goal_ms",
      "kind": "metric_threshold",
      "predicate": "<=15000",
      "aggregate": "median_across_seeds",
      "observed": {
        "value": 11890,
        "stddev": 800,
        "n_seeds": 5
      },
      "status": "passed"
    },
    {
      "name": "video_artifact_present",
      "kind": "artifact_exists",
      "predicate": "runs/${run_id}/replay.mp4",
      "status": "passed",
      "artifact_refs": [
        "run_a1:replay.mp4",
        "run_a2:replay.mp4",
        "run_a3:replay.mp4",
        "run_a4:replay.mp4",
        "run_a5:replay.mp4"
      ]
    },
    {
      "name": "diff_scope",
      "kind": "diff_scope",
      "predicate": "src/nav/",
      "observed": {
        "files_changed": 2,
        "all_inside_scope": true,
        "files": [
          "src/nav/replay_buffer.py",
          "tests/nav/test_replay_buffer.py"
        ]
      },
      "status": "passed"
    },
    {
      "name": "cleanroom_verified",
      "kind": "cleanroom_rerun",
      "predicate": "all_metrics_match_within_tolerance",
      "observed": { "matched": true, "tolerance": 0.05 },
      "status": "passed"
    }
  ],
  "runs": [
    "run_a1",
    "run_a2",
    "run_a3",
    "run_a4",
    "run_a5",
    "run_cleanroom_a1"
  ],
  "overrides": [],
  "concerns_pinned": [],
  "metadata": {
    "codex_thread_id": "thr_zb9k1p",
    "code_sha": "f8a9b2c4",
    "profile_version": "v1",
    "range_version": "0.1.0"
  }
}
```

A `passed-with-concerns` record carries the same shape plus a non-empty `concerns_pinned` array (each entry a step range with a note). A `failed` record has at least one check with status `failed`. An `overridden` record has a non-empty `overrides` array, each entry with `reason`, `signer`, and `timestamp`.
