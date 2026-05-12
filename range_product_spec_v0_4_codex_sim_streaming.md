# Range Product Specification v0.4

**Document type:** Product Requirements Document (PRD)  
**Product name:** Range  
**Category:** Simulation Development Harness / SimOps Workbench  
**Status:** Draft v0.4 - Codex-first V1 with Simulation Streaming and Range naming  
**Date:** 2026-05-11  
**Primary audience:** founder/product lead, engineering lead, developer-experience lead, infra lead

---

## 0. Decision Log

### v0.4 update: product name is Range

The product name is now **Range**. The category remains **Simulation Development Harness**.

Range should be treated as a simple product noun, not an implementation descriptor. The metaphor is a proving ground: a place where Codex-powered changes are run, observed, verified, and packaged with evidence before they become pull requests.

Preferred positioning:

> Range gives Codex a proving ground for simulation-heavy software.

Avoid returning to compound infrastructure names such as `SimHarness`, `TraceRig`, `TestRig`, or `SimRig` in user-facing copy. Those names describe implementation mechanics; Range describes the product experience.

### v0.3 update: simulation streaming is first-class

V1 should not treat streaming as generic remote desktop. Range needs a **simulation streaming layer** that can carry logs, metrics, state, frames, videos, sensor outputs, and artifacts from a simulator or training run back into the conversational workflow.

The design should be inspired by `ovrtx` and Warp, but not hard-code V1 to Omniverse:

- `ovrtx`-style sources emit rendered/sensor streams: camera frames, depth/semantic outputs, lidar/radar-like data, thumbnails, videos, and renderer status.
- Warp-style sources emit simulation/training state: poses, contacts, rewards, losses, trajectories, kernel timings, and metric frames.
- Remote desktop or WebRTC viewport streaming is a fallback or P1 capability; the canonical evidence should be structured simulation events and artifact checksums whenever possible.

### Confirmed product decisions

1. **V1 uses Codex only.**
   - Range will not support Claude, Cursor, Devin-style agents, or multiple provider routing in V1.
   - The V1 agent integration target is Codex: CLI, SDK, app-server, and/or non-interactive execution, depending on the integration path validated during the technical spike.

2. **Range does not reinvent the coding agent.**
   - Codex owns reasoning, coding, conversational implementation, code edits, and command execution inside the selected workspace.
   - Range owns task context, worktree setup, environment setup, remote GPU execution, simulation-specific artifact capture, verification, permissions, and PR packaging.

3. **The UX is conversation-first.**
   - The user should not be dropped into a rigid form that says: "Implement this task."
   - The user should be able to say things like:
     - "Pull in my latest task."
     - "Fetch SIM-1842."
     - "Use Codex to investigate this first."
     - "Create a separate attempt from main."
     - "Run the failing scenario on the GPU runner."
     - "Show me the video diff."
     - "Open a PR with evidence."

4. **Git worktrees are the isolation primitive.**
   - Every serious task, investigation, fix, verification run, or parallel attempt gets a worktree.
   - Worktrees are developer-visible as "attempts," not as low-level Git mechanics.

5. **The moat is domain-specific hardness.**
   - The product is valuable only if Codex becomes materially better for simulation, robotics, training, synthetic-data, physical-AI, and GPU-heavy development when launched through Range.

---

## 1. Executive Summary

Range is a **conversational, Codex-first development harness for simulation-heavy software**.

It lets a developer start from a natural conversation, pull in task context from GitHub/Jira/bug trackers, create an isolated Git worktree, run Codex inside the right local or remote execution environment, stream simulation logs/metrics/state/frames/videos/artifacts, verify the result with simulation-specific checks, and package the result into an evidence-backed pull request.

The product is not a new coding agent, not a generic cloud IDE, not a Kubernetes dashboard, and not an MLOps tracker.

The wedge:

> Codex can edit code. Range gives Codex a proving ground for simulation-heavy development: task context, worktrees, GPUs, simulators, artifact capture, verification, and review evidence.

---

## 2. Product Vision

Simulation-heavy development has a different shape from typical application development. Developers are often debugging failures that depend on:

- simulator configuration;
- robot/world state;
- GPU type;
- rendering backend;
- sensor output;
- dataset or scenario version;
- seed;
- policy checkpoint;
- physics settings;
- timing;
- infrastructure state;
- visual output;
- training/evaluation metrics.

Generic coding agents are already strong at conversation, code reading, file edits, test execution, and PR drafting. The missing piece is a harness that gives the agent the right **domain-specific execution and verification substrate**.

Range turns this messy process into a repeatable loop:

```text
conversation
-> task retrieval
-> context pack
-> isolated worktree attempt
-> Codex session
-> local or remote GPU execution
-> simulation stream: logs / metrics / state / frames / video / artifacts
-> verification
-> review package
-> PR / task update
```

Long-term vision:

> Every simulation task has an isolated attempt, every attempt has a reproducible environment, every agent action is observable, every result has evidence, and every PR carries the proof needed to trust it.

---

## 3. Positioning

### 3.1 Category

**Simulation Development Harness**

Alternative category names:

- SimOps Workbench
- Domain-Specific Agent Harness
- Robotics/Simulation Development Control Plane
- Evidence-Backed Agent Development Harness

### 3.2 One-line description

> Range is a Codex-first conversational harness for simulation-heavy development: isolated attempts, GPU execution, simulation streaming, and evidence-backed verification.

### 3.3 What it is

- A conversational shell around Codex for simulation-heavy development.
- A task-to-worktree-to-verification workflow engine.
- A local and remote execution harness for GPU-backed simulation and training runs.
- A simulation streaming viewer for logs, terminal output, visual output, metrics, state snapshots, sensor/render frames, videos, and files.
- A review-package generator that turns agent work into a trustworthy PR.

### 3.4 What it is not

- Not a replacement for Codex.
- Not a model provider.
- Not a generic AI IDE.
- Not a generic cloud development environment.
- Not a generic Kubernetes dashboard.
- Not an experiment tracker.
- Not a robotics simulator.
- Not a project management system.

---

## 4. Core Product Thesis

### 4.1 Critical thesis

> The product wins if developers feel that Codex is significantly more useful for robotics, simulation, training, and physical-AI workflows when run through Range than when used alone.

### 4.2 What Range adds to Codex

| Need | Codex alone | Range + Codex |
|---|---|---|
| Conversational coding | Strong | Preserved |
| Code edits | Strong | Preserved |
| Task retrieval | Generic / limited | GitHub/Jira/bug-aware |
| Work isolation | Available in Codex surfaces, but generic | Domain task attempts with explicit worktree lifecycle |
| GPU execution | Environment-dependent | First-class local/remote runner abstraction |
| Simulation setup | Manual / repo-specific | Environment profiles and reproducible setup |
| Visual artifacts | Ad hoc | Captured, streamed, indexed, linked |
| Metrics and scenario validation | Ad hoc | Verification profiles and thresholds |
| PR evidence | Mostly text + tests | Diff + logs + video + metrics + reproduction command |
| Team trust | Variable | Evidence-backed and auditable |

### 4.3 Strategic boundary

Range should not try to improve Codex's reasoning loop. It should improve the **world around Codex**:

- better context in;
- safer workspace;
- correct environment;
- richer runtime feedback;
- stronger verification;
- better evidence out.

---

## 5. Target Users

### 5.1 Primary user: simulation/robotics developer

Jobs:

- reproduce a simulation bug;
- debug sensor/rendering output;
- run robot scenario replay;
- inspect logs, videos, trajectories, and metrics;
- use Codex to implement a fix;
- verify a patch in a clean worktree;
- open a PR with evidence.

### 5.2 Primary user: embodied AI / training engineer

Jobs:

- run policy evaluation;
- compare metrics across seeds;
- debug training failures;
- collect checkpoints and plots;
- validate that a change improves or does not regress a metric;
- generate reviewable artifacts.

### 5.3 Secondary user: developer productivity / infra engineer

Jobs:

- provide standard environment profiles;
- manage GPU runner policies;
- govern credentials;
- define verification profiles;
- audit agent sessions;
- reduce wasted GPU time.

---

## 6. Product Principles

### 6.1 Codex-first, provider-later

V1 supports only Codex. The internal architecture should avoid hard-coding every concept to Codex, but the product surface should not expose provider selection in V1.

Developer-facing language:

```text
Use Codex to investigate this.
Use Codex to make a fix attempt.
Ask Codex to summarize the failed run.
```

Not V1 language:

```text
Choose from Claude, Codex, Cursor, Agent X, Agent Y.
```

### 6.2 Conversation-first, structure-backed

The user interacts conversationally. Range quietly maintains structured state:

```text
task
context pack
attempt
worktree
Codex thread/session
runner
run
artifact
verification result
review package
```

### 6.3 Attempts, not raw worktrees

Developer-facing concept:

```text
Attempt
```

Internal concept:

```text
Git worktree + branch + Codex session + run history + artifacts + verification status
```

Examples:

```text
SIM-1842
├── baseline-main
├── codex-investigate
├── codex-fix-minimal
└── cleanroom-verify
```

### 6.4 Domain evidence beats narration

Agent summaries are insufficient. A credible result needs evidence:

- command run;
- environment profile;
- simulator version;
- seed;
- logs;
- screenshots/video;
- metrics;
- artifacts;
- diff;
- verification status;
- reproduction command.

### 6.5 Remote execution is a capability, not the product

Kubernetes/GPU infrastructure is an execution backend. The product is not a Kubernetes UI.

### 6.6 GitHub remains the source of record

Git is abstracted in the UX but preserved for branches, commits, PRs, review, rollback, and audit.

---

## 7. V1 Scope

### 7.1 V1 goal

A developer can conversationally pull in a task, create an isolated Codex attempt, run Codex in a worktree, execute a configured simulation/evaluation command locally or on a remote GPU runner, capture artifacts, verify the result, and open a GitHub PR with evidence.

### 7.2 P0 features

#### Conversational shell

- Natural-language entry point.
- Handles task-retrieval intents:
  - "Pull in my latest task."
  - "Fetch task SIM-1842."
  - "Start from this GitHub issue."
  - "Reproduce the failing scenario."
- Shows structured task card after context retrieval.
- Lets the user steer Codex conversationally.

#### Codex integration

- V1 supports Codex only.
- Launch Codex in a task worktree.
- Stream Codex messages/events when available.
- Capture Codex command executions, file changes, and final messages.
- Support interactive continuation of a prior attempt.
- Support non-interactive automation for verification summaries and PR package generation.

#### Task context

- GitHub issue support.
- GitHub PR support for review/verification flows.
- Jira support if credentials and project configuration exist.
- Plain prompt support.
- Context pack generation:
  - task description;
  - linked repo;
  - suspected commands;
  - files/paths if known;
  - acceptance criteria;
  - reproduction steps;
  - attached artifacts/logs;
  - verification targets.

#### Git/worktree management

- Repository cache.
- Create attempt-specific branch/worktree.
- Track base branch/SHA.
- One writer per worktree.
- Diff viewer.
- Promote attempt to PR.
- Discard/archive attempts.

#### Environment profiles

- Project-level `range.yaml`.
- Profile contains setup, commands, artifact globs, metrics, and GPU requirements.
- Initial profile types:
  - `local-cpu`;
  - `local-gpu`;
  - `remote-gpu`;
  - `headless-sim`;
  - `training-eval`.

#### Execution

- Local shell runner.
- Docker runner optional.
- Remote GPU runner via Kubernetes or SSH-backed runner.
- Run commands defined by profile:
  - build;
  - test;
  - reproduce;
  - simulate;
  - evaluate;
  - train;
  - render/capture.

#### Simulation Streaming

- Terminal logs.
- Codex event stream.
- File changes.
- Git diff.
- Run status.
- Artifact discovery.
- Basic image/video artifact preview.
- V1 simulation stream abstraction with:
  - metric events;
  - state snapshot events;
  - frame/image events;
  - video segment events;
  - artifact checksum events;
  - runner health events.
- Profile-level stream adapters for command output, JSONL event files, metrics files, screenshots, videos, and simulator-specific emitters.
- Pixel/viewport streaming only when the simulator profile supports it; do not make generic desktop streaming the core primitive.

#### Verification

- Command-level pass/fail.
- Artifact existence checks.
- Metric threshold checks from JSON/CSV/log parsers.
- Reproduction command capture.
- Clean worktree verification flow.

#### PR packaging

- PR title/body generation.
- Links to task and attempts.
- Commands run.
- Environment profile.
- Metrics.
- Artifact links.
- Known risks.
- Reproduction instructions.

### 7.3 P1 features

- Interactive remote desktop / simulator viewport streaming through WebRTC or equivalent when needed.
- Rich video diffing.
- Metric trend charts.
- Parallel Codex attempts.
- Better cleanroom verification.
- Workspace suspend/resume.
- Jira write-back.
- Bug tracker adapters.
- Team policy/audit console.

### 7.4 Explicit non-goals for V1

- Claude integration.
- Cursor integration.
- Multi-provider routing.
- Building a new coding agent.
- Building a generic cloud IDE.
- Building a generic experiment tracker.
- Building a Kubernetes dashboard.
- Replacing GitHub PR review.
- Full MLOps lineage tracking.

---

## 8. Core Concepts

### 8.1 Task

A unit of work from GitHub, Jira, a bug tracker, or a plain prompt.

Example:

```yaml
task_id: SIM-1842
source: jira
summary: Navigation regression in warehouse_dense_v3
repo: robot-nav-sim
base_branch: main
acceptance_criteria:
  - reproduce failure on seed 42
  - fix regression without changing planner public API
  - success_rate >= 0.92
```

### 8.2 Attempt

A developer-facing unit of isolated work.

Internal fields:

```yaml
attempt_id: att_123
name: codex-fix-minimal
task_id: SIM-1842
agent: codex
worktree_path: .range/worktrees/SIM-1842-codex-fix-minimal
branch: range/SIM-1842-codex-fix-minimal
base_sha: abc123
runner: remote-gpu
state: running
```

### 8.3 Context pack

A structured bundle passed to Codex and displayed to the user.

Contains:

- task summary;
- exact goal;
- non-goals;
- repo/branch;
- suspected files;
- reproduction command;
- verification command;
- environment profile;
- constraints;
- known risks;
- artifacts/logs;
- PR expectations.

### 8.4 Environment profile

Project-owned configuration for running domain workflows.

Example:

```yaml
profiles:
  robot-sim-gpu:
    image: ghcr.io/acme/robot-sim:2026.05
    gpu: 1
    runner: remote-gpu
    setup:
      - python -m pip install -e .
    commands:
      test: pytest tests/nav/test_policy_replay.py
      reproduce: python scenarios/run.py warehouse_dense_v3 --seed 42 --record video
      evaluate: python eval_policy.py --scenario warehouse_dense_v3 --seeds 42,43,44
    artifacts:
      - runs/**/*.mp4
      - runs/**/metrics.json
      - runs/**/*.log
    metrics:
      success_rate:
        source: runs/latest/metrics.json
        path: $.success_rate
        min: 0.92
```

### 8.5 Run

One command or job execution inside an attempt.

Examples:

- build run;
- test run;
- reproduce run;
- simulation rollout;
- training run;
- evaluation run;
- cleanroom verification run.

### 8.6 Artifact

Output generated by a run.

Examples:

- logs;
- videos;
- screenshots;
- metrics JSON;
- trajectories;
- checkpoints;
- crash dumps;
- render frames;
- dataset samples;
- diff patch;
- PR evidence bundle.

### 8.7 Verification result

A structured result that evaluates whether the attempt satisfied the task.

Example:

```yaml
verification_id: ver_789
attempt_id: att_123
status: passed
checks:
  - name: unit_tests
    status: passed
  - name: reproduce_scenario
    status: passed
  - name: success_rate
    status: passed
    observed: 0.94
    threshold: ">=0.92"
  - name: video_artifact
    status: passed
    artifact: runs/2026-05-11/warehouse_dense_v3.mp4
```

---

## 9. Core Developer Flows

### Flow 1: Pull in latest task

**User says:**

```text
Pull in my latest task.
```

**System behavior:**

1. Query configured task sources.
2. Rank tasks assigned to the user by recency, status, and repo relevance.
3. Show top candidates.
4. Suggest the likely repo and environment profile.
5. Ask for one clarification only if required.

**Example response:**

```text
Found 3 likely tasks. SIM-1842 is the most recent active task assigned to you.

Task: Navigation regression in warehouse_dense_v3
Repo: robot-nav-sim
Suggested profile: robot-sim-gpu
Suggested first step: reproduce the scenario on seed 42 before allowing code changes.
```

### Flow 2: Fetch task ID

**User says:**

```text
Fetch SIM-1842 and reproduce it.
```

**System behavior:**

1. Fetch task.
2. Build context pack.
3. Create `baseline-main` attempt.
4. Run the reproduction command.
5. Capture logs, video, and metrics.
6. Report whether the bug reproduced.

### Flow 3: Codex investigation attempt

**User says:**

```text
Use Codex to investigate first. No code changes yet.
```

**System behavior:**

1. Create read-only or restricted write attempt.
2. Launch Codex with context pack.
3. Restrict permissions according to investigation mode.
4. Stream Codex events and terminal output.
5. Capture investigation summary.
6. Preserve logs/artifacts.

**Success criteria:**

- Codex identifies likely causes with evidence.
- No unintended code changes are made.
- The user can promote the attempt to implementation mode or discard it.

### Flow 4: Codex implementation attempt

**User says:**

```text
Now let Codex make the smallest safe fix in a separate attempt.
```

**System behavior:**

1. Create a new worktree from the selected base.
2. Launch Codex in workspace-write mode.
3. Provide implementation constraints.
4. Track file edits and commands.
5. Run configured tests and reproduction commands.
6. Generate diff and verification status.

### Flow 5: Remote GPU simulation run

**User says:**

```text
Run the failing scenario on the remote GPU runner.
```

**System behavior:**

1. Resolve environment profile.
2. Provision runner.
3. Sync or mount worktree.
4. Run configured command.
5. Stream logs, metric events, state snapshots, and frame/artifact events when emitted by the profile.
6. Capture screenshots, videos, sensor outputs, checkpoints, traces, and raw artifacts.
7. Parse metrics.
8. Attach results to attempt with checksums and timestamps.

### Flow 6: Artifact inspection

**User says:**

```text
Show me the video and metric diff.
```

**System behavior:**

1. Show baseline and candidate artifacts.
2. Show metric comparison.
3. Show trajectory or video preview.
4. Link artifacts to run IDs and commands.

### Flow 7: Cleanroom verification

**User says:**

```text
Verify this from a clean worktree.
```

**System behavior:**

1. Create fresh worktree from base SHA.
2. Apply selected patch.
3. Run setup from profile.
4. Re-run verification commands.
5. Compare artifacts and metrics.
6. Mark result reproducible or not.

### Flow 8: Open PR with evidence

**User says:**

```text
Open the PR with evidence.
```

**System behavior:**

1. Prepare PR branch.
2. Commit selected diff.
3. Generate PR body.
4. Attach evidence links.
5. Update task status/comment.
6. Preserve attempt history.

**PR body must include:**

- task link;
- problem summary;
- implementation summary;
- files changed;
- verification commands;
- environment profile;
- metrics before/after;
- artifacts;
- known risks;
- reproduction instructions.

### Flow 9: Resume attempt

**User says:**

```text
Resume the Codex fix attempt from yesterday.
```

**System behavior:**

1. Restore attempt metadata.
2. Check worktree status.
3. Restore Codex thread/session if available.
4. Show latest diff and verification state.
5. Continue conversation.

---

## 10. UX Requirements

### 10.1 Main screen

The main surface starts with a conversational composer:

```text
What are we working on?
```

Suggested actions:

- Pull in my latest task
- Fetch a task ID
- Start from a GitHub issue
- Reproduce a failing scenario
- Verify a PR
- Start from this repo

### 10.2 Persistent side panels

The conversation should be paired with evidence panels:

```text
Left: Task / context / attempts
Center: Conversation + Codex stream
Right: Diff / files / artifacts
Bottom: Runs / logs / metrics / GPU status
```

### 10.3 Attempt panel

Shows:

- attempt name;
- base branch/SHA;
- Codex status;
- worktree path;
- permissions;
- changed files;
- runs;
- artifacts;
- verification status;
- promote/discard actions.

### 10.4 Simulation stream and artifact viewer

Must support:

- logs;
- screenshots;
- videos;
- JSON metrics;
- CSV metrics;
- trajectory files;
- links to raw artifacts;
- live run status;
- latest frame preview where available;
- metric timeline for running commands;
- state/sensor event inspection from JSONL or simulator adapter streams.

P1 should support:

- live desktop/viewport stream;
- side-by-side video comparison;
- frame-level visual diff;
- trajectory overlays.

### 10.5 Verification page

Shows claims against evidence:

```text
Claim: navigation regression fixed.
Evidence:
- pytest passed
- warehouse_dense_v3 seed 42 completed
- success_rate: 0.94 >= 0.92
- collision_count: 0
- video artifact generated
- cleanroom verification passed
```

---

## 11. Simulation Streaming Model

### 11.1 Product stance

Simulation streaming is not the same as desktop streaming.

Desktop streaming sends pixels from a remote machine. It is useful when the user needs to visually inspect or interact with a GUI simulator, but it is weak as a verification primitive because pixels alone do not explain what happened.

Range should treat streaming as a layered simulation evidence channel:

```text
Level 0: Logs and command status
Level 1: Metrics and structured state events
Level 2: Screenshots, frames, videos, sensor outputs, trajectories, checkpoints
Level 3: Live viewport or remote desktop stream
Level 4: Interactive simulator control
```

V1 should implement Levels 0-2. Level 3 can be supported opportunistically through profile-specific integrations. Level 4 is explicitly post-MVP.

### 11.2 Why this matters

Simulation-heavy development needs more than terminal output:

- A test can pass while the robot behavior is visually wrong.
- A policy can improve one metric while regressing collisions, smoothness, or safety.
- A renderer/sensor bug may only be visible in frames, depth output, or semantic masks.
- A training run may look healthy in logs but fail in trajectory playback.
- Codex may claim success without attaching enough evidence to trust the result.

Range should force the run to produce evidence that a developer can inspect conversationally:

```text
"Show me the frame where it failed."
"Compare the trajectory before and after the patch."
"What changed in reward, collision count, and path length?"
"Open the video next to the baseline."
"Use this artifact in the PR evidence section."
```

### 11.3 Stream types

Every run can emit a canonical event stream, stored as JSONL and mirrored live to the UI.

```json
{"type":"run.started","run_id":"run_123","attempt_id":"sim-1842-codex-fix","ts":"2026-05-11T08:00:00Z"}
{"type":"log","stream":"stdout","message":"starting warehouse_dense_v3"}
{"type":"metric","name":"success_rate","value":0.94,"step":1200}
{"type":"state","name":"robot_pose","value":{"x":1.2,"y":3.4,"theta":0.8},"step":1200}
{"type":"frame","name":"camera_front","path":"frames/camera_front_001200.png","sha256":"...","step":1200}
{"type":"artifact","name":"trajectory_video","path":"videos/warehouse_dense_v3.mp4","sha256":"..."}
{"type":"run.finished","exit_code":0,"verification":"passed"}
```

V1 event families:

- `log`: stdout, stderr, simulator logs, Codex-visible command output.
- `metric`: reward, loss, success rate, collisions, FPS, latency, GPU memory, sim steps/sec.
- `state`: robot pose, object pose, contact state, controller state, scenario phase.
- `frame`: screenshots, camera frames, depth/semantic previews, renderer outputs.
- `video_segment`: rolling MP4/WebM chunks or completed replay videos.
- `sensor`: structured sensor outputs where the profile supports them.
- `artifact`: checkpoints, traces, videos, CSV/JSON metrics, crash dumps.
- `health`: runner heartbeat, GPU usage, process status, stream lag.

### 11.4 Adapter model

Range should not require every simulator to implement a custom plugin on day one. Use three adapter levels.

#### Adapter A: File and command adapter

Default V1 path.

The profile declares artifact globs and metrics parsers:

```yaml
streams:
  events: runs/latest/events.jsonl
  logs: runs/latest/*.log
  metrics: runs/latest/metrics.json
  frames: runs/latest/frames/*.png
  videos: runs/latest/videos/*.mp4
  trajectories: runs/latest/trajectories/*.json
```

Works with almost any Python sim, training loop, or test harness.

#### Adapter B: Library emitter

The project imports a small Range client library:

```python
from range_sdk import stream

stream.metric("success_rate", success_rate, step=t)
stream.state("robot_pose", {"x": x, "y": y, "theta": theta}, step=t)
stream.frame("camera_front", image_array, step=t)
stream.artifact("trajectory_video", "runs/latest/video.mp4")
```

This is the recommended path for demos and early adopters because it creates clean live evidence without depending on one simulator vendor.

#### Adapter C: Simulator-native adapter

Used when the simulator has native streaming/render/sensor APIs.

Examples:

- `ovrtx` adapter for RTX/sensor/render output.
- Warp adapter for simulation state, kernel timings, trajectories, reward/state buffers, and GPU-side metrics.
- Isaac/MuJoCo/Gazebo/ROS adapters later.

### 11.5 `ovrtx`-inspired model

`ovrtx` should inform the render/sensor side of Range.

The product should expect simulator profiles to emit:

- RGB frames;
- depth previews;
- semantic/segmentation previews;
- lidar/radar-like sensor artifacts where applicable;
- camera metadata;
- renderer status;
- frame timestamps;
- frame checksums;
- video clips;
- render failure diagnostics.

V1 should not depend on `ovrtx`, because the product needs to stay simulator-agnostic. But the event model should be rich enough that an `ovrtx` backend can plug in cleanly later.

### 11.6 Warp-inspired model

Warp should inform the simulation-state side of Range.

The product should expect simulator/training profiles to emit:

- state arrays summarized into inspectable events;
- pose/velocity/contact snapshots;
- reward and loss curves;
- rollout metrics;
- trajectory artifacts;
- simulation step timings;
- GPU kernel/runtime timings where available;
- policy checkpoint links;
- clean replay seeds.

V1 should not require users to write Warp code. The important design principle is that Range treats simulation state and GPU-compute metrics as first-class stream data, not just as opaque terminal output.

### 11.7 Viewport streaming policy

Remote desktop or live viewport streaming is useful, but it should not become the foundation.

Use viewport streaming when:

- the simulator is GUI-first;
- the user needs visual interactive inspection;
- a Kit/Omniverse-style app already exposes WebRTC streaming;
- the task is about rendering, sensors, or visual behavior;
- the developer explicitly asks to see the live simulation.

Do not use viewport streaming as the only evidence source. Every viewport session should still produce:

- run ID;
- command;
- environment profile;
- frame/video artifacts;
- metrics;
- checksums;
- reproduction instructions.

### 11.8 V1 acceptance criteria

V1 simulation streaming is successful when:

- a profile can declare logs, metrics, frames, videos, and artifacts;
- a run can stream those objects live or near-live to the UI;
- the user can ask conversationally for the latest frame, video, or metric diff;
- artifacts are checksummed and tied to a run ID, worktree, commit SHA, and command;
- PR evidence can include selected stream artifacts;
- lack of evidence is visible rather than hidden behind a successful Codex summary.

---

## 12. Codex Integration Strategy

### 11.1 Integration requirement

V1 should integrate with Codex in the simplest reliable way that preserves conversation, event visibility, and controllable execution.

### 11.2 Candidate integration paths

#### Path A: Codex SDK

Best for productized server-side integration if SDK event/control coverage is sufficient.

Expected use:

- start/resume Codex thread;
- send prompt/context pack;
- stream or poll result;
- attach to worktree directory;
- preserve thread IDs.

#### Path B: Codex app-server

Best for deep product UI integration if the protocol is stable enough for V1.

Expected use:

- app owns UI;
- app-server owns Codex conversation state;
- stream agent events;
- surface approvals;
- attach to remote workspaces;
- support local or remote Codex runtime.

Risk:

- WebSocket transport may be experimental/unsupported depending on the current Codex release.
- V1 must validate auth, streaming, reconnect, and session recovery before depending on it.

#### Path C: `codex exec --json`

Best for automation, verification summaries, PR summaries, batch steps, and backend tasks.

Expected use:

- run Codex non-interactively;
- capture JSONL events;
- enforce sandbox/approval settings;
- pipe logs/context into Codex;
- produce structured outputs.

#### Path D: Codex CLI/TUI subprocess

Best for early prototype but weakest for polished product UX.

Expected use:

- spawn Codex in a PTY;
- stream terminal output;
- rely on Codex's native TUI;
- fastest way to prove workflow.

Risk:

- terminal UI parsing is brittle;
- not enough structured state for durable product UX.

### 11.3 Recommended V1 sequence

1. **Prototype:** spawn Codex CLI in a worktree and stream terminal output.
2. **Automation:** use `codex exec --json` for structured non-interactive jobs.
3. **Product UI:** validate SDK/app-server for rich conversation, approvals, and streamed events.
4. **Stabilize:** hide all integration-specific complexity behind a single `CodexAdapter`.

### 11.4 CodexAdapter interface

```ts
interface CodexAdapter {
  startAttempt(input: {
    worktreePath: string;
    contextPackPath: string;
    mode: "investigate" | "implement" | "summarize" | "review";
    sandbox: "read-only" | "workspace-write";
    approvalPolicy: "manual" | "on-request" | "never";
  }): Promise<CodexSession>;

  sendMessage(sessionId: string, message: string): Promise<void>;
  streamEvents(sessionId: string): AsyncIterable<CodexEvent>;
  resume(sessionId: string): Promise<CodexSession>;
  stop(sessionId: string): Promise<void>;
  collectDiff(sessionId: string): Promise<GitDiff>;
  summarize(sessionId: string): Promise<AttemptSummary>;
}
```

### 11.5 Future provider expansion

Provider expansion is allowed only after V1 proves the domain harness.

Future providers should plug into a separate `AgentAdapter` interface, but the V1 product should not expose this complexity.

---

## 13. Technical Architecture

```text
Conversational UI
        |
        v
Intent + Task Context Layer
        |
        v
Worktree / Attempt Manager
        |
        v
Codex Adapter
        |
        v
Execution Harness
   +----+-----+-------------+
   |          |             |
Local     Docker       Remote GPU Runner
        
        |
        v
Artifact + Streaming Layer
        |
        v
Verification Engine
        |
        v
Review Package / PR / Task Update
```

### 12.1 Services

#### Conversation service

- Maintains user conversation.
- Resolves intents.
- Calls task connectors.
- Builds task context.
- Launches Codex attempts.

#### Task service

- GitHub issues/PRs.
- Jira tasks.
- Plain prompts.
- Future bug tracker adapters.

#### Attempt/worktree service

- Creates worktrees.
- Tracks branches/base SHAs.
- Enforces write locks.
- Produces diffs.
- Archives/discards attempts.

#### Codex service

- Manages Codex sessions.
- Streams events.
- Handles resumption.
- Applies policy.
- Bridges to SDK/app-server/CLI as selected.

#### Runner service

- Runs commands locally or remotely.
- Provisions remote runner.
- Syncs worktree.
- Streams logs.
- Captures artifacts.

#### Artifact service

- Stores logs, videos, metrics, screenshots, patches, and reports.
- Computes checksums.
- Provides signed links.
- Associates artifacts with runs and attempts.

#### Verification service

- Runs checks.
- Parses metrics.
- Compares against thresholds.
- Produces verification result.

#### PR service

- Creates branch/commit/PR.
- Generates evidence-backed PR body.
- Updates GitHub/Jira comments.

---

## 14. Data Model Draft

### 13.1 Entities

```text
User
Project
Repo
Task
ContextPack
Attempt
Worktree
CodexSession
Runner
Run
Artifact
VerificationResult
ReviewPackage
PullRequest
```

### 13.2 Relationships

```text
Task 1 -> N Attempts
Attempt 1 -> 1 Worktree
Attempt 1 -> 1 CodexSession
Attempt 1 -> N Runs
Run 1 -> N Artifacts
Attempt 1 -> N VerificationResults
Attempt 0..1 -> PullRequest
```

### 13.3 Attempt state machine

```text
created
-> context_ready
-> worktree_ready
-> codex_running
-> waiting_for_user
-> running_command
-> verification_pending
-> verification_passed
-> verification_failed
-> review_ready
-> pr_opened
-> archived
```

---

## 15. Security and Permissions

### 14.1 Default stance

Codex is a semi-trusted worker. It can inspect and modify a scoped workspace, but it should not receive broad authority by default.

### 14.2 Permission gates

Require explicit approval for:

- pushing commits;
- opening PRs;
- updating Jira/task status;
- accessing secrets;
- launching expensive GPU jobs;
- using broad network access;
- mutating cluster resources;
- deleting artifacts;
- touching protected branches;
- exporting data outside approved stores.

### 14.3 Investigation mode

Default permissions:

- read repo;
- run safe commands;
- inspect logs/artifacts;
- no file writes unless approved;
- no push;
- no external network beyond configured allowlist.

### 14.4 Implementation mode

Default permissions:

- workspace-write inside attempt worktree;
- run configured commands;
- write artifacts to attempt directory;
- no protected branch mutation;
- no push without approval.

### 14.5 Credential model

- Use short-lived credentials.
- Scope credentials to repo/task/runner.
- Never persist broad credentials inside worktrees.
- Log credential grants.
- Avoid passing secrets into Codex prompts.

---

## 16. Verification Model

### 15.1 Correctness layers

#### Transport correctness

Did Range faithfully capture what happened?

Checks:

- ordered event stream;
- run IDs;
- command exit codes;
- artifact checksums;
- timestamped logs;
- runner identity;
- environment digest.

#### Semantic correctness

Did the change solve the task?

Checks:

- tests passed;
- scenario reproduced before fix;
- scenario passed after fix;
- metrics crossed threshold;
- video/screenshot exists;
- no unintended files changed;
- cleanroom verification passed;
- PR evidence matches actual artifacts.

### 15.2 MVP verification checks

- Command exit status.
- Artifact existence.
- Metric threshold from JSON.
- Diff scope check.
- Clean worktree re-run.
- Human approval.

### 15.3 Future verification checks

- Visual diff.
- Video diff.
- Trajectory comparison.
- Multi-seed statistical comparison.
- Regression suite selection.
- Performance budget checks.
- Simulator determinism analysis.

---

## 17. Example PR Evidence Package

```markdown
# Fix SIM-1842: warehouse_dense_v3 navigation regression

## Summary
Fixed a regression in replay buffer timestamp handling that caused stale obstacle state during warehouse_dense_v3 navigation rollouts.

## Task
- Source: SIM-1842
- Repo: robot-nav-sim
- Base: main@abc123

## Attempt
- Attempt: codex-fix-minimal
- Worktree: range/SIM-1842-codex-fix-minimal
- Agent: Codex
- Profile: robot-sim-gpu

## Files changed
- src/nav/replay_buffer.py
- tests/nav/test_policy_replay.py

## Verification
| Check | Result |
|---|---|
| Unit tests | Passed |
| warehouse_dense_v3 seed 42 | Passed |
| success_rate | 0.94 >= 0.92 |
| collision_count | 0 |
| Cleanroom verification | Passed |

## Artifacts
- Video: runs/SIM-1842/codex-fix-minimal/warehouse_dense_v3_seed42.mp4
- Metrics: runs/SIM-1842/codex-fix-minimal/metrics.json
- Logs: runs/SIM-1842/codex-fix-minimal/sim.log

## Reproduce
```bash
range verify --task SIM-1842 --attempt codex-fix-minimal --clean
```

## Risks
- Only validated on warehouse_dense_v3 and seeds 42,43,44.
- Planner public API was not changed.
```

---

## 18. MVP Build Plan

### Phase 0: Codex spike

Goal: prove Codex can be controlled reliably enough for product UX.

Tasks:

- Launch Codex in a generated worktree.
- Test `codex exec --json` event capture.
- Test SDK/app-server integration.
- Test session resume.
- Test file-change detection.
- Test approval and sandbox behavior.

Exit criteria:

- Range can start a Codex attempt, stream structured progress, collect diff, and resume the attempt.

### Phase 1: Local harness

Goal: prove the domain workflow without remote infrastructure.

Tasks:

- Conversation shell.
- GitHub issue fetch.
- Worktree creation.
- Context pack generation.
- Codex launch.
- Local verification command.
- Artifact capture.
- PR draft.

Exit criteria:

- A developer can go from GitHub issue to local Codex attempt to evidence-backed PR draft.

### Phase 2: Remote runner

Goal: run domain commands on remote GPU infrastructure.

Tasks:

- Remote runner API.
- Worktree sync/mount.
- GPU profile.
- Log streaming.
- Artifact collection.
- Runner cleanup.

Exit criteria:

- A developer can ask Codex to make a fix, then run the verification command on a remote GPU runner and see artifacts in the UI.

### Phase 3: Simulation verification

Goal: make the product clearly domain-specific.

Tasks:

- Metrics parser.
- Video artifact viewer.
- Baseline vs candidate comparison.
- Cleanroom verification.
- Strong PR evidence package.

Exit criteria:

- The PR is materially more trustworthy than a generic Codex PR because it contains reproducible simulation evidence.

---

## 19. Success Metrics

### Activation

- Time from first launch to first task context pack.
- Time from task to first Codex attempt.
- Time from task to first verification run.

### Productivity

- Percentage of attempts that produce useful diffs.
- Time from issue to PR draft.
- Reduction in manual reproduction setup time.
- Number of reruns per accepted PR.

### Verification

- Percentage of PRs with artifact-backed evidence.
- Percentage of verification runs reproducible from clean worktree.
- Percentage of simulation failures reproduced before fix.
- Human acceptance rate of generated PR evidence.

### Infrastructure

- GPU utilization per run.
- Idle GPU time.
- Failed runner provisioning rate.
- Artifact upload failure rate.

### Trust and safety

- Permission approval/denial rate.
- Unauthorized command attempts.
- Secret access attempts.
- Worktree cleanup success rate.

---

## 20. Critical Risks and Mitigations

### 19.1 Risk: Product becomes a generic Codex UI

Failure mode:

- The product competes with Codex/Cursor/Claude interfaces instead of adding domain capability.

Mitigation:

- Put simulation profiles, GPU runs, artifacts, verification, and PR evidence at the center.
- Avoid overbuilding generic chat polish.

### 19.2 Risk: Codex integration surface changes

Failure mode:

- SDK/app-server/CLI behavior changes and breaks Range.

Mitigation:

- Keep `CodexAdapter` isolated.
- Start with supported automation surfaces.
- Use integration tests against pinned Codex versions.
- Preserve fallback to `codex exec --json` for automation.

### 19.3 Risk: Codex Cloud confuses the product boundary

Failure mode:

- Users ask why they should use Range instead of Codex Cloud.

Mitigation:

- Position Range as the domain harness for custom GPU/sim environments, artifact capture, verification, and evidence packaging.
- Integrate with Codex; do not compete with Codex's generic cloud task flow.

### 19.4 Risk: Worktree sprawl

Failure mode:

- Attempts accumulate and become unmanageable.

Mitigation:

- TTLs.
- Archive/discard states.
- Per-task attempt grouping.
- Cleanup dashboard.

### 19.5 Risk: GPU cost explosion

Failure mode:

- Agents launch expensive workloads unnecessarily.

Mitigation:

- GPU budget per task.
- Approval gates for expensive jobs.
- Idle shutdown.
- Low-cost local dry-run mode.
- Queue and quotas.

### 19.6 Risk: Verification is too weak

Failure mode:

- PRs still rely on agent summaries.

Mitigation:

- Require command/artifact/metric evidence.
- Make cleanroom verification a first-class flow.
- Make missing evidence visually obvious in the PR package.

---

## 21. Open Questions

### Product

- Should the first user surface be web app, desktop app, or CLI-first with web cockpit?
- Should the first task source be GitHub issues or plain prompt plus repo?
- How opinionated should the default `range.yaml` be?

### Codex integration

- Which Codex surface gives the best combination of conversation, events, approvals, and stability for V1?
- Is SDK/app-server stable enough for rich UI integration, or should V1 rely mostly on `codex exec --json` and terminal streaming?
- How should Range preserve Codex conversation history across worktree movement/resume?

### Execution

- Should remote runner v1 be Kubernetes, SSH VM, or local Docker first?
- What is the minimum useful GPU runner abstraction?
- How are worktrees synced to remote runners: git fetch, rsync, volume mount, or artifact bundle?

### Simulation streaming

- What is the minimum V1 stream: logs + metrics + screenshots, or logs + metrics + video?
- Should viewport streaming be implemented through WebRTC, noVNC-style desktop streaming, or simulator-native APIs?
- Should the first demo use file-command adapters, a Range Python client, or an `ovrtx`/Warp-specific adapter?
- What should be the canonical stream format: JSONL only, gRPC/WebSocket events, or both?

### Verification

- What domain should the first demo target: MuJoCo, Isaac Sim, Gazebo, ROS 2, custom Python sim, or training/eval pipeline?
- What artifact gives the clearest "aha": video, metric delta, cleanroom rerun, or PR evidence bundle?

---

## 22. External Source Notes

The following public Codex and simulation-platform capabilities informed this V1 direction:

- Codex CLI can run locally from the terminal, read/change/run code in the selected directory, and is available across major operating systems: https://developers.openai.com/codex/cli
- Codex Web can work on tasks in the background and create pull requests from GitHub-connected repositories: https://developers.openai.com/codex/cloud
- Codex app worktrees support independent tasks in the same project without interfering with each other: https://developers.openai.com/codex/app/worktrees
- `codex exec` supports non-interactive automation, JSONL event output, sandbox settings, and CI/script usage: https://developers.openai.com/codex/noninteractive
- Codex app-server is intended for richer product integrations with authentication, conversation history, approvals, and streamed agent events: https://developers.openai.com/codex/app-server
- Codex SDK provides programmatic control from server-side applications: https://developers.openai.com/codex/sdk
- NVIDIA `ovrtx` exposes Omniverse RTX through C/Python for physically accurate sensor simulation and visualization: https://nvidia-omniverse.github.io/ovrtx/
- NVIDIA Warp is a Python framework for GPU-accelerated simulation, robotics, and machine learning, with JIT-compiled CPU/GPU kernels: https://nvidia.github.io/warp/
- Omniverse Kit WebRTC livestreaming provides browser access to streams from Kit applications: https://docs.omniverse.nvidia.com/kit/docs/omni.services.livestream.webrtc/latest/Overview.html

---

## 23. Final Product Statement

> Range is a Codex-first conversational development harness for simulation-heavy software. It lets developers pull in tasks, create isolated worktree attempts, run Codex in the right local or remote GPU environment, stream simulation logs, metrics, state, frames, videos, and artifacts, verify simulation/training results, and open evidence-backed GitHub pull requests.

