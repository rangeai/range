# Range — Product Spec v0.5

**Document type:** Product spec, prioritized roadmap
**Status:** Active — supersedes v0.4 for direction; v0.4 still authoritative on the agent/sim-streaming architecture
**Date:** 2026-05-16
**Builds on:**
- [`../archive/range_product_spec_v0_4_codex_sim_streaming.md`](../archive/range_product_spec_v0_4_codex_sim_streaming.md) (the Codex + sim streaming architecture)
- [`positioning.md`](positioning.md) (NVIDIA-independent, public-repo-only positioning)
- [`direction/2026_05_14.md`](direction/2026_05_14.md) (the dogfood-vs-product question)
- [`direction/2026_05_15.md`](direction/2026_05_15.md) (agentic-only commitment, target audience)

This doc consolidates everything we've learned since direction_2026_05_15
— particularly the May 2026 web-research pass into what sim engineers
actually complain about — and turns it into an ordered roadmap.

---

## 0. The strategic answer, in one paragraph

Range is **the agentic IDE for engineers building robot policies on
Isaac Lab, MuJoCo Playground/MJX, Drake, or any general-purpose
robot-training stack.** They already use Cursor or Claude Code for
their code; they already use Hydra + W&B / TensorBoard for tracking;
they already run their sims on local workstations or K8s clusters.
What they're missing is an **agent-aware orchestrator that
understands sim concepts as first-class primitives** — scenarios,
sweeps, metrics, artifacts, regression suites, reward functions,
checkpoints — and that lets them describe intent in natural language
("investigate why warehouse_a fails when seed > 5") and get back a
real investigation with reproduction, evidence, and a proposed fix.

Yard stays dogfood, capped at 2,000 LOC, sole purpose: surface
workflows that sharpen Range. The product is Range.

---

## 1. What we ship today (as of v0.5)

For traceability, here is the current product surface — what a sim
engineer gets if they `git clone` Range and attach their repo today:

- **Agentic chat** with Codex, auto-started per session
- **`range.yaml` profile** that declares: commands, scenarios,
  scenario sweeps with cartesian-product fan-out, verification gates,
  optional metrics contract via `${RANGE_RUN_DIR}/metrics.json`
- **Inline conversation cards** — run rows, sweep groups, artifact
  previews (USD/video/png/csv/json), file-edit cards, approval
  cards, PR drafts, all in the chat timeline
- **Per-turn collapsing** — reasoning items collapse to
  `· Thought for 7s`; each turn auto-collapses on completion with a
  summary line; manual toggle stays sticky
- **Slash command picker** with layer badges (range/codex/scenario/command)
  - Range builtins: `/pr`, `/restart`, `/clear`
  - Codex builtins: `/model`, `/think`, `/sandbox`, `/approvals`,
    `/compact`, `/tokens`, `/diff`
  - Scenarios + commands from `range.yaml` auto-listed
- **Approval controls** — per-binary allowlist ("always allow git"),
  per-session auto-approve toggle, sandbox switcher
- **`range` CLI** on `$PATH` inside Codex, with `RANGE_SESSION` env
  preset, so Codex calls it like any other shell tool
- **Codex meta-controls** visible: model + reasoning + live token
  usage as pills in the worktree header bar
- **Live event surface** wired to Codex JSON-RPC: token usage,
  turn-level diffs, plan updates (received but not yet displayed
  — see roadmap), context-compacted signals
- **Session persistence** — events.jsonl on disk; conversation
  rehydrates on refresh; runs/artifacts in SQLite
- **PR drafting + opening** via the `gh` CLI

The product is structurally complete for the "investigate a failure
in a small sim repo" loop. What's missing is the *breadth* needed to
serve the actual audience.

---

## 2. Confirmed pain points (from the field, May 2026)

Research conducted via web search on what sim engineers actually
complain about — open Isaac Lab issues, GitHub discussions, Hacker
News threads, Medium write-ups, arXiv survey papers. Each item below
has at least one cited primary source.

### 2.1 Isaac Lab onboarding is brutal

> *"One barrier for understanding Isaac Lab projects is that the
> example projects are all built into the file structure of the
> source code, which setup makes it difficult to track down the
> Python imports and to get a handle on the workflow."* — Justin
> Costa, "Introduction to Isaac Lab RL with the Isaac Humanoid"
> (Toward Humanoids, 2025)

NVIDIA themselves ship a template generator to bandage this, which
is a tell. The on-ramp for a new user attaching their Isaac Lab repo
to *any* tool — including Range — has a 30-to-60-minute YAML/imports
tax before they get value.

### 2.2 Sensor & state sync after reset is a known footgun

> *"When resetting environments, some data fields of assets and
> sensors are not updated, including poses of links, camera images,
> contact sensor readings, and lidar point clouds. The cameras may
> also produce blank first frames because the simulator needs time
> to load material textures and fill render targets."* — Isaac Lab
> Known Issues page

There is no debugger for this. Engineers spend hours figuring out
why their reward signal is zero on the first tick of every episode.

### 2.3 Checkpoint resume is broken

> *"Training resume from checkpoint, where the progress bar starts
> from 0% even after loading a checkpoint, and TensorBoard timesteps
> reset to 0 instead of continuing from the checkpoint timestep."*
> — open issue isaac-sim/IsaacLab#4047, mid-2025

Live bug. Causes confusion and wasted compute when people don't
realize they're double-training.

### 2.4 Hydra + W&B integration is fragile

The two most-used config/tracking tools in RL don't compose cleanly:

- Wandb process hangs when used with Hydra — workaround:
  `wandb.init(settings=wandb.Settings(start_method="thread"))`
- Hydra config and `wandb.config` don't merge automatically during
  sweeps (open issue wandb/wandb#4686)
- OmegaConf DictConfig can't be passed directly to `wandb.Run.config`
  — needs manual primitive-dict conversion
- Can't sweep over Hydra `+param=value` dynamic parameters via W&B

These are not edge cases. They are the *normal* config-tracking flow
being broken for ~80% of RL teams.

### 2.5 NaNs in observation buffers, no debugger

> *"One common error seen during RL training is the appearance of
> NaNs in the observation buffers, which often occur when the
> simulation becomes unstable."* — Isaac Lab training guide

The standard advice is "make your sim more stable." There is no
inspector, no automated "where did the NaN first appear" tool.

### 2.6 Number-of-envs is trial-and-error against GPU memory

> *"The number of environments becomes an important hyperparameter
> for training... however, the number of environments can be
> bounded by other factors, with memory often being a hard
> constraint."* — Isaac Lab docs

Engineers spend real time finding the highest N that fits. No tool
helps with this.

### 2.7 Long startup times that scale with env count

> *"Environment creation time scales linearly with the number of
> environments, resulting in longer load times when running
> thousands of environments."* — Isaac Lab Known Issues

Every "tweak a reward, restart" iteration is gated by shader-compile
+ asset-load wait.

### 2.8 Manager-based observation hiding

> *"In Isaac Lab manager-based training setups, the observation
> vector is abstracted away, making it unclear what the exact
> observation length or structure is."* — issue #3697

The structure that's supposed to help organize code becomes a
debugging dead zone.

### 2.9 Robotics DevOps is "disjointed islands"

> *"Most enterprises are in the 'independent edge' phase with
> 'disjointed islands' of technology rather than unified platforms.
> Robotics organizations struggle transitioning from custom, manual
> workflows to standardized CI/CD pipelines."* — HN #47102305
> (mid-2025)

Every serious team has built their own pipeline. None of them love
it.

### 2.10 Reward function design has no good tooling

Multiple 2024-2025 papers (notably arXiv 2408.10215 reward
engineering survey, arXiv 2511.19355 on LLM-assisted reward design)
frame reward design as the bottleneck. No tool surfaces reward
functions as first-class artifacts you can A/B test.

### 2.11 Sim-to-real gap is the universal hard problem

Across NVIDIA, Google Research, MIT CSAIL, the consistent themes
are: domain randomization helps but is fragile; real-to-sim-to-real
workflows are the new frontier; foundation models like Cosmos help
generate diverse synthetic data; the gap is closing but not closed.
This is the meta-problem the field is investing against.

### Meta-observation

About **70% of the cited pain points are debugging, observability,
or workflow-reconciliation problems — not algorithm or physics
problems**. That's precisely where an agentic harness wins.

---

## 3. What this confirms / invalidates from prior docs

### Confirmed

- **Agentic-only UI direction** (direction_2026_05_15) — the daily
  problems are diagnosis-and-iteration, exactly the loop chat-first
  enables.
- **Yard stays dogfood** (direction_2026_05_14, _15) — nothing in
  the research suggests building our own sim. The pain is in
  workflow around existing sims.
- **`range.yaml` as a contract** — the auto-scaffold direction is
  even more important than thought, because every audience-segment
  starting point (Isaac Lab manager-based env, Playground env,
  custom MuJoCo script) is a different file structure.

### Invalidated / reweighted

- **Remote compute as the next big thing** — deprioritized. The
  research shows the local-iteration loop is what hurts, not the
  remote compute layer. SkyPilot / Kueue / Ray integration moves to
  v0.7+ unless a specific customer asks.
- **3D scene viewer** — deprioritized. Nobody complained in the
  research. USDview/standard viewers are fine.
- **Hyperparameter search algorithms (Optuna, ASHA, etc.)** —
  deprioritized. Hydra+W&B reconciliation is more urgent than
  smarter search algorithms; smarter search comes later.
- **Codex MCP server** (from `direction_2026_05_15`'s deferred
  list) — still deferred. The `range` CLI handles 90% of what MCP
  would. Revisit only if catalog grows past ~20 tools.

### Newly added based on research

- **NaN / instability investigation flow** as a first-class scenario
  (matches pain #2.5)
- **Hydra + W&B integration helper** as a slash builtin
  (matches pain #2.4)
- **Reward function as a tracked entity in `range.yaml`**
  (matches pain #2.10)
- **Checkpoint as a tracked entity in `range.yaml`**
  (matches pain #2.3)
- **Observation inspector** (matches pain #2.8)

---

## 4. The prioritized roadmap

Five priorities, in order. Each is a buildable chunk with a
specific success criterion.

### P1 — Auto-scaffolded `range.yaml`

**One-line:** Attach a repo → Range writes the initial profile, with
templates per detected stack.

**Why it matters:** Pain #2.1. Today every new user has a 30–60 min
YAML-authoring tax before they see Range's value. NVIDIA's own
solution is a template generator, so the bar is clear.

**Scope:**

- Detect on attach: Isaac Lab template projects, Isaac Lab
  manager-based envs, MuJoCo Playground repos, Drake repos, generic
  `train.py` + `pyproject.toml` layouts, custom MJCF setups.
- For each detected pattern, generate a `range.yaml` proposal with:
  - Commands inferred from `pyproject.toml` / Makefile / README
  - Scenarios inferred from `envs/` / `tasks/` / `scenes/` dirs
  - Sensible default sweep grids for the smoke-eval pattern
  - A pointer to where the user's reward function lives (P4 below
    consumes this)
- Present the proposal as an inline approval card; user can edit
  before accepting.

**Success criterion:** A new user attaching public MuJoCo
Playground gets a working `range.yaml` within 60s of attach, with
at least one scenario clicking through to a successful run.
Attaching Isaac Lab generates a correct proposal verified by
inspection (the "successful run" gate doesn't apply — no Mac
runtime).

**Rough effort:** 1 week. Code generation logic + a handful of
detectors + UI flow.

### P2 — NaN / instability investigation flow

**One-line:** Codex-led, tight-loop: detect divergence → bisect to
first bad step → propose stability fix.

**Why it matters:** Pain #2.5. Daily-frequency problem. No existing
tool helps. Maps exactly onto the Codex investigation strength.

**Scope:**

- New scenario hook in `range.yaml`: `on_failure: {check: nan, ...}`
- Range runs the scenario with extra instrumentation when the user
  asks "why is this diverging" — log observations every N steps,
  store as artifact
- Codex (via the CLI) gets a `range trajectory inspect <run>` that
  reports first-NaN step + the observation values leading up to it
- Pattern: Codex bisects across seeds + scenarios to isolate the
  trigger, proposes a fix (lower learning rate, clip gradients, fix
  contact margin, etc.)

**Success criterion:** Against a planted "NaN bug" in Yard's PD
controller (a divide-by-zero path triggered by specific seeds),
Codex finds it in under 5 turns and proposes the correct fix.

**Rough effort:** 1–2 weeks. Mostly Codex prompt scaffolding +
trajectory-inspection CLI plumbing. Reuses existing
artifact/metrics infrastructure.

### P3 — Hydra + W&B integration helper

**One-line:** Slash builtin (`/wire`) that resolves the known
Hydra+W&B config-merging bugs and writes correct sweep syntax.

**Why it matters:** Pain #2.4. Every Hydra+W&B user fights this on
every sweep — typical 30 min lost per sweep setup. The fix is
mechanical but obscure; perfect for an agent.

**Scope:**

- Detect Hydra config in a repo (`conf/` dir, `@hydra.main`
  decorator, `OmegaConf` import patterns)
- Detect W&B usage (`wandb.init`, `wandb.config`, sweep YAMLs)
- `/wire wandb-hydra` inserts the canonical-correct integration:
  the `start_method="thread"` workaround, the
  `OmegaConf.to_container` conversion before `wandb.config`, and a
  sweep YAML that uses Hydra overrides instead of W&B params
- Detect the `+param=value` dynamic-param gotcha and warn
- Generate a one-paragraph explanation of what got changed and why

**Success criterion:** Against a stock public MuJoCo Playground
+ W&B setup, `/wire wandb-hydra` produces a working sweep
launcher with no hangs and merged configs visible in W&B.

**Rough effort:** 1 week. Detection rules + a code-modification
helper + a test against the canonical broken patterns.

### P4 — Checkpoint + reward function as first-class entities

**One-line:** Track checkpoints + reward functions in `range.yaml`;
make A/B testing them easy.

**Why it matters:** Pains #2.3 (broken checkpoint resume) and #2.10
(no reward-function tooling). Two of the most frequently-iterated
artifacts in RL workflows are essentially invisible to current
tooling.

**Scope:**

Checkpoints:
- `range.yaml` gains a `checkpoints:` block with patterns (e.g.,
  `pattern: "logs/runs/*/model_*.pt"`)
- Range scans for matching files post-run, surfaces them as inline
  cards
- `/eval checkpoint=<path>` slash builtin runs the scenario against
  a frozen checkpoint
- Range remembers "you last loaded checkpoint X at step Y," which
  bypasses the Isaac Lab resume bug

Reward functions:
- `range.yaml` declares `reward_functions:` pointing at file +
  function name (e.g., `path: tasks/walker.py`, `function:
  compute_reward`)
- Range surfaces the reward function inline when a user opens a
  scenario card
- `/reward diff a.py:func b.py:func` runs the same scenario with
  two reward variants and renders a side-by-side metrics table

**Success criterion:** In Playground's locomotion suite (e.g.,
G1/H1/Cassie), the user can load a checkpoint and eval it in one
slash command; they can A/B two reward variants and see a
metrics comparison.

**Rough effort:** 2 weeks. Most of the work is the scan + UI; the
A/B comparison reuses sweep infrastructure.

### P5 — Plan tracking + trajectory view

**One-line:** Codex emits `turn/plan/updated`; we render it as a
checklist pinned to the top of the turn. Inline trajectory viewer
for `.npz` artifacts.

**Why it matters:** Pain #2.8 (observation hiding) is partly a
visualization gap — give engineers a fast way to scrub trajectories
and inspect observations. The plan-tracking piece is small but adds
"this feels guided" polish to multi-step investigations.

**Scope:**

Plan tracking:
- WS handler for `turn/plan/updated`
- TurnCard gets a plan section above the children — list of plan
  items with state (pending/in-progress/done)
- Updates live as Codex emits

Trajectory view:
- For `trajectory.npz` artifacts, render an interactive plot
  inline (joint angles / position over time / per-step rewards /
  contact forces). One axis per field; scrub bar.
- `/obs <run> <step>` shows the observation vector at a specific
  step (closes the gap in pain #2.8 for manager-based envs).

**Success criterion:** A live investigation shows Codex's plan
filling in as it works. A `trajectory.npz` from Yard renders as a
4-row time-series plot with a scrubber.

**Rough effort:** 1 week. Plan tracking is small; trajectory
viewer uses existing libraries (e.g., `uplot` or `Plotly` for
React) — install + adapt.

---

## 5. Explicitly deprioritized

Things that are real but not next. We will not build them in v0.5;
revisit when conditions are met.

| item | why deprioritized | revisit when |
|---|---|---|
| **3D scene viewer (USD/MJCF)** | Nobody complained in research. USDview/external tools cover it. | A customer specifically asks |
| **W&B chart embedding** | Link-out from a run card is enough. Engineers already have W&B open in another tab. | We have W&B-using customers in 5+ sessions |
| **Hyperparameter search algorithms (Optuna, BOHB, ASHA)** | Hydra+W&B reconciliation is more urgent. Grid sweeps cover the smoke-eval use case. | After P3 ships and at least one customer asks for smarter search |
| **Remote compute integrations (SkyPilot, K8s+Kueue, Ray, Modal)** | The pain is local iteration, not remote scaling. BYO-compute `/remote` covers the gap. | Range has paying customers and one of them runs training that doesn't fit locally |
| **Codex MCP server** | The `range` CLI covers 90% of what MCP would. Token-economical. | CLI catalog grows past ~20 tools, or we need streaming structured events |
| **Multi-user / team collaboration** | Single-user works for the first 5 customers. Collaboration is v0.7. | First team-of-3+ customer signs up |
| **Notebooks integration** | Jupyter is already a separate workflow people use. Range doesn't displace it. | A customer specifically asks |
| **First-class "experiment" abstraction** | Let the shape emerge from usage; don't pre-design it. | After 5+ users have grouped sweeps + comparisons themselves and we see the pattern |

---

## 6. Architectural decisions to lock in

A few choices that feed the roadmap and should not be revisited
without a strong reason:

- **`range.yaml` is the contract.** All audience-specific
  detection (Isaac Lab vs Playground vs Drake vs ROS) maps into the
  same yaml shape. Detectors live in code; the schema doesn't grow
  per stack.
- **Codex CLI > MCP, until proven otherwise.** Range's API is
  exposed to Codex through `bash` invocations of `range ...`. This
  has shipped, works, is cheap.
- **Conversation is the workspace.** No new top-level panels.
  Everything new is an inline card kind.
- **Slash builtins are the manual override.** Default is "Codex
  picks via natural language." Slash is for power users + when the
  user knows exactly what they want without explaining.
- **Yard stays small.** 2,000 LOC cap. Don't grow it past warehouse
  scenarios. Yard is the planted-bug substrate, not the primary
  dogfood — see §7.

---

## 7. Test substrate

Range needs substrates to validate against. Yard alone is
insufficient: it doesn't have Hydra, doesn't have W&B hooks,
doesn't have a manager-based env shape, doesn't have reward
functions structured the way Isaac Lab or Playground users write
them. P1's detectors will pattern-match against shapes Yard
doesn't have.

We also can't run Isaac Sim on a Mac — RTX renderer, CUDA, no
Metal path. So end-to-end "investigate a failing scenario"
testing on the founder's machine has to lean on Mac-runnable
substrates.

**Substrate order, in priority:**

1. **MuJoCo Playground** (github.com/google-deepmind/mujoco_playground) —
   primary dogfood. JAX/MJX-based, Mac-runnable, real audience
   shape: locomotion + manipulation + dm_control envs under
   `_src/`, training scripts under `learning/`, reward functions
   as methods on env classes. This is what ML researchers reach
   for to prototype a policy before paying the Isaac Lab tax —
   exactly the workflow Range targets. P1's first detector
   targets Playground.
2. **Yard** (`~/personal/yard`, 2k LOC cap) — planted-bug
   substrate for P2 (NaN/instability investigation). Smallest
   possible end-to-end loop, controlled enough to plant
   divergence bugs and verify Codex finds them.
3. **Isaac Lab** (github.com/isaac-sim/IsaacLab) — file-shape
   fixture only, not runnable on Mac. Proves P1's detectors
   generalize to the canonical manager-based pattern even though
   the user can't launch a scenario. Closing the runnable loop
   for Isaac Lab users requires remote execution (Linux + NVIDIA
   GPU box) — that's v0.7 territory, not v0.5.
4. **`tests/fixtures/`** — minimal frozen directory layouts
   (10–30 files each) representing each detected shape. Pure
   unit-test material for detector logic.

**Implication for v0.5 success criteria:** the "5-minute
attach-to-first-run" gold path is measured against Playground.
The "detection works" gold path is measured against Isaac Lab
(correct scaffold generated even though no scenario actually
launches). Yard remains for P2's end-to-end bug-hunt
verification.

**Implication for the audience:** Bucket 2 includes both
Playground users (who we serve fully on a Mac) and Isaac Lab
users (who we serve detection + scaffolding now, end-to-end
later). Both ship under v0.5; the Isaac Lab "we detect but can't
run" gap closes in v0.7 with remote compute.

---

## 8. Success criteria for v0.5

What "done" looks like for this spec, in terms a future reader can
check:

1. **A new user attaching public MuJoCo Playground** can run their
   first scenario end-to-end via Range within 5 minutes — no manual
   YAML authoring.
1b. **A new user attaching public Isaac Lab** gets a correct
   `range.yaml` proposal (scenarios, commands, reward function
   pointers) within 60s, verified by inspection — runnability is
   gated on remote compute, not v0.5.
2. **The NaN-investigation flow** finds a planted instability bug
   in Yard in under 5 Codex turns.
3. **The `/wire` builtin** produces a working Hydra+W&B sweep
   against a known-broken canonical setup (Playground + W&B is
   the test target since Isaac Lab can't run locally).
4. **Checkpoint + reward function tracking** is real in `range.yaml`
   and a user can A/B two reward variants in one slash command.
5. **Codex plans render live**; trajectory artifacts open in a
   scrubber.

When all five are met, v0.5 is done and we re-evaluate priorities
based on the next round of evidence (preferably from real users).

---

## 9. What to keep an eye on (not roadmap, but watchlist)

Things that might shift priority if conditions change:

- **MuJoCo Playground adoption curve.** If Playground eats Isaac
  Lab's share (plausible — it's lighter and the team prefers it for
  prototyping), P1's detection should weight Playground more.
- **Foundation-model robotics workflows.** If π0 / Helix / GR00T-
  style VLA training becomes the dominant pattern, the abstractions
  shift: reward functions matter less, demonstration datasets and
  VLM-judge eval matter more.
- **Codex app-server protocol evolution.** Codex's JSON-RPC surface
  is growing (we saw `thread/fork`, `thread/rollback`,
  `model/list`, `model/rerouted` in the May 2026 schema). If a new
  method enables something we faked (e.g., real conversation
  compact, real plan updates), prefer the native path.
- **Open-source competitors.** No one in the agentic-harness-for-
  sim space yet, but watch:
  - LangSmith / OpenAI Agents toolkit getting sim plugins
  - Cursor extending into orchestration
  - Hugging Face Spaces shipping a chat-driven sim runner

---

## 10. References

Primary research sources (May 2026 web search), with full URLs in
`direction_2026_05_15.md` follow-up:

- Isaac Lab Known Issues + Troubleshooting + Training Guide
  (isaac-sim.github.io/IsaacLab)
- Open issues isaac-sim/IsaacLab#3697 (policy deployment),
  #4047 (checkpoint resume), discussion #4628 (deformable RL)
- "Introduction to Isaac Lab RL with the Isaac Humanoid" —
  Justin Costa, Toward Humanoids on Medium
- HN #47102305: "The Reason Robotics DevOps Is Failing to Scale"
- wandb/wandb#4686 (Hydra sweep config merging),
  Wandb-Hydra docs
- JarvisLabs blog: "ML Experiment Tracking: Complete Guide to W&B
  and Hydra"
- AMD ROCm blog: "Training a Robotic Arm Using MuJoCo and JAX"
- MuJoCo Playground technical report (Jan 2025) +
  google-deepmind/mujoco_playground
- arXiv 2408.10215: Reward engineering survey
- arXiv 2511.19355: LLMs for reward function design
- arXiv 2502.13187: Sim-to-real methods survey
- arXiv 2512.01996: Sim-to-real humanoid locomotion in 15 min
- MIT CSAIL: real-to-sim-to-real workflow
- Google Research blog: generalized sim-to-real transfer
- NVIDIA developer blog: Cosmos + robotic assembly training

Internal:
- `range_product_spec_v0_4_codex_sim_streaming.md`
- `range_positioning_v0_1.md`
- `range_scenarios_v0_1.md`
- `range_sim_stack_support_v0_1.md`
- `direction_2026_05_14.md`
- `direction_2026_05_15.md`
- `yard_product_spec_v0_1.md`

---

## 11. Working order

Build P1 → P2 → P3 → P4 → P5, no surprises.

After each P ships:
1. Live-test against MuJoCo Playground (primary dogfood) and Yard
   (planted-bug verification, P2 onward). Spot-check detection
   against Isaac Lab even when not runnable.
2. Capture one paragraph of feel-feedback ("what worked, what
   didn't") in a follow-up direction doc
3. Re-rank priorities if the feedback warrants

Hold the discipline of *not* building deprioritized things until
the conditions in §5 are met. Doing the right things in the right
order matters more than building each thing well.
