# Range — User Guide

**Status:** Living document, v0.5
**For:** Software engineers who want to try Range. No robotics
background assumed.
**Reading time:** 30–45 minutes end-to-end. Each section stands
alone; jump around freely.

---

## Contents

- [1. What is Range, in one paragraph](#1-what-is-range-in-one-paragraph)
- [2. The 60-second context dump (zero robotics needed)](#2-the-60-second-context-dump-zero-robotics-needed)
- [3. The cast: Range, Yard, Playground, Isaac Lab](#3-the-cast-range-yard-playground-isaac-lab)
- [4. Concepts you'll trip over (ELI5)](#4-concepts-youll-trip-over-eli5)
- [5. Getting set up](#5-getting-set-up)
- [6. The first-time tour (10 minutes)](#6-the-first-time-tour-10-minutes)
- [7. Walkthroughs: any Python repo (SB3-zoo)](#7-walkthroughs-any-python-repo-sb3-zoo)
- [8. Scenario catalog — what you can run](#8-scenario-catalog--what-you-can-run)
- [9. Slash command reference](#9-slash-command-reference)
- [10. Investigation flows](#10-investigation-flows)
- [11. Where things live (file map)](#11-where-things-live-file-map)
- [12. Glossary](#12-glossary)
- [13. Pointers for further reading](#13-pointers-for-further-reading)

---

## 1. What is Range, in one paragraph

Range is an **agent-driven IDE for engineers training robot policies in
simulators**. You attach a code repo (one of yours, or one of the
public ones like MuJoCo Playground), Range understands its shape, lets
you run training scenarios, watch metrics, investigate crashes, edit
code, and ship pull requests — all from inside a chat-first UI backed
by a Codex agent. Think of it as Cursor for sim-RL workflows. It's
explicitly *not* a new simulator: it sits on top of whatever sim stack
you're already using.

---

## 2. The 60-second context dump (zero robotics needed)

Skip this section if you've trained an RL policy before.

**The thing people do at the office:**

1. They have a simulator that models a robot (a quadruped, a
   humanoid, a robot arm) in a virtual world.
2. They have a "policy" — a neural network whose job is to map
   *what the robot sees* (joint angles, camera depth, IMU readings)
   to *what the robot should do next* (motor torques).
3. They train the policy by running millions of episodes inside the
   simulator. Each episode: reset the world, let the policy drive
   the robot for a few seconds, measure how well it did, nudge the
   policy's weights toward "do more of that."
4. After hours-to-weeks of training, the policy can do useful
   things — walk, balance, pick up cubes.

**The thing they actually spend their day doing:**

- Watching dashboards.
- Wondering why episode reward dropped after a code change.
- Wondering why a specific seed crashes.
- Wondering why a specific scenario diverges to NaN.
- Wiring Hydra to W&B without it hanging.
- Loading a checkpoint and running it 100 times to see if it
  generalizes.

**Range's pitch:** that second list — the meta-work around training
— is what most teams burn the most hours on, and what tools don't
help with. Range targets it directly.

---

## 3a. Picking an agent backend (Codex vs OpenCode)

Range talks to *some* AI agent under the hood; the agent reads your
code, makes plans, edits files, and runs commands on your behalf.
There are two backends shipped with v0.6, and you pick one when
creating a session:

| | **Codex** (default) | **OpenCode** |
|---|---|---|
| **What it is** | OpenAI's official agent CLI | Open-source, provider-agnostic agent |
| **LLMs supported** | OpenAI (GPT-5, o1, etc.) | Anthropic, OpenAI, Google, Ollama (local), and more — anything OpenCode supports |
| **License of agent itself** | Closed | MIT |
| **Compliance-friendly?** | OpenAI only | Pick the provider that fits |
| **Best for** | Fastest setup, OpenAI users | Teams that need a specific provider, local models, or BYOK |

Both backends speak the same Range surface — scaffolds, scenarios,
`/investigate`, `/wire`, `/eval`, `/reward show`, `/obs`,
trajectory scrubber, plan tracking. A few Codex-specific slash
items (`/model`, `/think`, `/approvals`) are hidden on OpenCode
sessions because they map to Codex's `thread/start` params; the
rest work identically.

You change backends only at session-create time (radio button in
the home composer). Switching backends mid-session would lose
conversation context; instead, create a new session.

---

## 3. The cast: Range, Yard, Playground, Isaac Lab

Range plays nice with anything; in practice it ships with three
example substrates you can poke at right out of the gate.

| name | what it is | runs on Mac? | what it's for |
|---|---|---|---|
| **Range** | this tool | yes | the harness itself |
| **Yard** | a tiny ~1,400-LOC MuJoCo robot sim that ships planted bugs | yes | the smallest possible end-to-end loop to learn Range on |
| **MuJoCo Playground** | DeepMind's JAX/MJX environment library (50+ envs across locomotion, manipulation, dm_control) | yes | the realistic substrate most ML researchers actually use |
| **Isaac Lab** | NVIDIA's full-stack sim framework, 170+ tasks | **no** (needs RTX GPU) | scaffold/detection testing only — you can't *run* anything but Range can plan the integration |

**Recommended path:** start with **Yard** (no extra deps), graduate to
**Playground** once you want a real audience-shaped substrate.

---

## 4. Concepts you'll trip over (ELI5)

Just enough so the rest of the doc doesn't lose you. The Yard repo
has deeper reads:

- `yard/ELI5_FOUNDATIONS.md` — math, physics, neural nets, sensors.
  1,300 lines of plain-English ramp-up.
- `yard/ELI5.md` — what robot-sim engineers actually do all day.

Quick definitions for *this* doc:

- **Simulator (sim):** a program that fakes a robot inside a fake
  world. Physics, sensors, contact, the works. We use MuJoCo most
  of the time; Yard and Playground both run on it.
- **Episode:** one trial. Reset the world, let the policy run for
  N steps, record what happened, restart.
- **Policy:** the neural network being trained. Takes
  observations in, spits actions out.
- **Reward function:** the thing that scores each step. "+1 for
  staying upright, -0.1 for jerky motor commands, -10 for falling."
  Engineering this well is half the job.
- **Trajectory:** the time-series of (observation, action, reward)
  tuples that come out of an episode.
- **Checkpoint:** a saved snapshot of the policy's weights. After a
  while of training, you save one; later you can load it and run
  inference without re-training.
- **Sandbox:** Codex's safety setting. `read-only` =  Codex can't
  edit anything; `workspace-write` = Codex can edit files in the
  attached repo; `danger-full-access` = no fences at all.
- **Scaffold:** the auto-generated `range.yaml` Range writes when
  you attach a fresh repo. Tells Range what to run.
- **Sweep:** one scenario × N seeds (or N hyperparameter combos). A
  way to ask "is this fragile or solid?"
- **Run:** one launch of one scenario at one seed. Has a state
  (running/succeeded/failed), metrics, artifacts.

That's enough. Press on.

---

## 5. Getting set up

See `docs/dev_setup.md` for the install steps. Three-line summary
once you've done that:

```bash
cd ~/personal/range/web
bun run dev
open http://localhost:5173/
```

Server runs on `:3457`, web UI on `:5173`.

If you also want Yard ready to attach:

```bash
git clone git@github.com:rangeai/yard.git ~/personal/yard
cd ~/personal/yard && uv sync
```

(Range itself doesn't need Yard cloned to function. It just helps
to have a working substrate.)

---

## 6. The first-time tour (10 minutes)

Stand up the dev server (`bun run dev` from `web/`), open
`http://localhost:5173/`, then:

### 6.1 Attach Yard

- Click **New session** on the home screen.
- Title: whatever.
- Repo path: pick `/Users/<you>/personal/yard` (or wherever you
  cloned it).
- Click create.

What you should see, within a second or two:

- A new session opens.
- Codex spawns in the background. (You'll see "Codex thread started"
  in the timeline.)
- **No scaffold proposal appears** — because Yard already has a
  hand-written `range.yaml`. Range only proposes scaffolds when one
  isn't already present.

### 6.2 Run a scenario from the slash picker

- Type `/` in the composer. The slash picker opens with everything
  available: builtins (range layer + codex layer), commands, and
  scenarios.
- Scroll to **`warehouse_a`**. Click it.

What happens:

- A new "run card" appears in the conversation: `▶ warehouse_a · …
  running …`
- Inside ~5 seconds, the run finishes. Metrics appear (success,
  ttg_s, collisions). Artifacts appear (replay.mp4, trajectory.npz,
  depth_frames/).

That's a full Range loop: ask for a scenario, watch the run, see
the artifacts.

### 6.3 Run a scenario with the planted bug

- Type `/warehouse_b_proximity_bug` and run it.
- The run finishes in ~10s, **state: failed**.

This is the canonical "NaN bug" Yard ships for testing Range's
investigation flow.

### 6.4 Investigate it

- Type `/investigate` (no arguments) and run.
- Range automatically picks the latest failed run.
- A system message appears: "Inspecting trajectory…"
- A new Codex turn fires with a full trajectory report attached:
  total ticks, first-NaN tick, affected fields, last 5 clean ticks
  + first 5 contaminated ticks for context.
- Codex reads the bug, opens `yard/apps/controllers/pd_to_goal.py`,
  finds the stale-sentinel block, and proposes a fix.

Whether Codex finds it in <5 turns is the actual P2 success
criterion — try it and see.

### 6.5 Attach MuJoCo Playground (optional)

Once you've cloned Playground:

- New session, repo path: `/path/to/mujoco_playground`.
- This time, a scaffold proposal card appears in the conversation:
  **`yml · scaffold proposal · MuJoCo Playground · 2 cmd · 3 scn · 53 reward fn`**.
- Click **accept**. Range writes `range.yaml` into the repo.
- Open the slash picker — you'll see the three picked scenarios
  (`g1_joystick_flat_terrain`, `aloha_hand_over`, `cartpole_balance`)
  and two commands (`install`, `smoke`).
- Run `/install` first (creates the .venv with Python 3.13 + syncs
  deps; takes 1–3 min the first time).
- Then `/cartpole_balance` — a real RL training run starts. (~30s
  of JAX compile then ticks start landing.)

---

## 7. Walkthroughs: any Python repo (SB3-zoo)

The Yard walkthrough above shows Range working on its dogfood sim.
These walkthroughs use **`DLR-RM/rl-baselines3-zoo`** — a real,
public Stable-Baselines3 training framework — to prove the same
loop works on arbitrary Python projects with zero Range-specific
prep.

**Prep (one time):**

```bash
git clone https://github.com/DLR-RM/rl-baselines3-zoo /tmp/range-test-projects/rl-baselines3-zoo
cd /tmp/range-test-projects/rl-baselines3-zoo
python3 -m venv .venv
.venv/bin/pip install -U pip
.venv/bin/pip install "stable-baselines3[extra]" sb3-contrib rl_zoo3 gymnasium
```

Each walkthrough below has:
1. **What you'll see** — the headline.
2. **Steps** — exact actions in Range.
3. **Video** — recorded end-to-end (inline GIF + full-quality mp4).

---

### 7.1 Cold import → auto-scaffold → first scenario

**What you'll see:** Range detects rl-baselines3-zoo as a generic
Python project, finds `train.py` at the root, surfaces `hyperparams/`,
and proposes a `range.yaml` with one starter scenario. The whole
thing — clone, detect, accept, scenarios visible — takes under 30
seconds.

**Steps:**

1. Click **new session** in the left nav.
2. Repo path: `/tmp/range-test-projects/rl-baselines3-zoo`.
3. Leave the prompt blank (or type whatever — it doesn't matter
   for the scaffold detection, which runs server-side on session
   create).
4. Press **Enter** to create the session.
5. Within ~2 seconds, a **scaffold proposal** card appears in the
   conversation:
   `yml · scaffold proposal · Generic Python · 3 cmd · 1 scn`
6. Click **accept · write range.yaml**. The card flips to
   `accepted ✓`.
7. Click into the composer, type `/` — the slash picker now lists
   `/train` (the auto-detected scenario) alongside `/install`,
   `/test`, and `/smoke`.

You're set up. The scaffolded YAML calls `python train.py` with
no extra arguments — that's intentional. Range doesn't pretend to
know what `--algo` or `--env` you want. You edit those in the next
walkthrough.

![SB3-zoo cold import → scaffold → scenarios](media/sb3-zoo.gif)

📹 Full quality: [`docs/media/sb3-zoo.mp4`](media/sb3-zoo.mp4)

---

### 7.2 First training run — CartPole PPO

**What you'll see:** A scenario that actually calls SB3 with real
`--algo ppo --env CartPole-v1 -n 30000` arguments. `/train` fires
the run, you watch the SB3 output stream into Range's run panel
live — rollout tables, `ep_rew_mean` ticking up from ~20 to ~200,
the success badge flipping at the end.

**Setup:**

After accepting the scaffold from §7.1, replace the `train`
scenario in `range.yaml` so it actually does something useful:

```yaml
scenarios:
  - name: train
    description: PPO + CartPole-v1, 30k steps
    args: [
      "/tmp/range-test-projects/rl-baselines3-zoo/.venv/bin/python",
      "train.py", "--algo", "ppo", "--env", "CartPole-v1",
      "-n", "30000",
      "--log-folder", "/tmp/range-sb3-logs"
    ]
    env:
      RANGE_RUN_DIR: "\${RANGE_RUN_DIR}"
```

> **Note:** we point at `.venv/bin/python` directly so the run uses
> the project's installed dependencies. Range's runner spawns the
> process; no shell activation needed.

**Steps:**

1. Save `range.yaml` (Range picks up the new args next time `/train`
   fires — runs always read the on-disk profile fresh).
2. Type `/train` in the composer, press **Enter**.
3. A run card appears in the conversation, state `running`.
4. Within a couple seconds, SB3's iteration tables start streaming
   into the run's output panel:
   ```
   | rollout/                |              |
   |    ep_len_mean          |     19.4     |
   |    ep_rew_mean          |     19.4     |
   ```
5. After ~5 seconds of training (30k steps at ~5.6k FPS),
   `ep_rew_mean` is in the 180–200 range and the run state flips
   to `succeeded`.

![SB3-zoo: /train → CartPole PPO output streaming](media/sb3-train.gif)

📹 Full quality: [`docs/media/sb3-train.mp4`](media/sb3-train.mp4)

---

### 7.3 Failing run → fix → re-run (coming soon)

The third walkthrough — point `/train` at an invalid gym env
(`CartPole-v9`), watch it fail, ask the agent to read the error
and patch `range.yaml`, then re-run — is in the queue but has a
client-side bug pinning it back. After the agent successfully
patches the YAML on disk, the next `/train` doesn't always render
in the conversation because the client caches the profile from
session start and doesn't refresh on file edits. See open task
**Profile-cache-stale fix**. Until then, the manual loop works
fine: stop the failed run, edit the env name in `range.yaml`,
type `/train` again.

---

## 8. Scenario catalog — what you can run

Scenarios live in each repo's `range.yaml`. Below is everything
shipped with the substrates Range knows about today.

> Note on naming: `range.yaml` is just declarative orchestration —
> the actual scenario code lives in each repo's Python (or whatever
> language). yaml says "what to run + what env vars to set"; the
> repo says "what those runs actually do."

### 7.1 Yard scenarios (`~/personal/yard/range.yaml`)

All warehouse scenarios drive the same diff-drive bot to a goal
across the same generic floor plan. The difference is layout +
length.

| scenario | what it does | typical time |
|---|---|---|
| `warehouse_a` | Open floor, scattered boxes. 1 seed = 1 run. | ~5s |
| `warehouse_b` | Narrow aisles. Tighter clearance. | ~5s |
| `warehouse_c` | Long path. Surfaces long-episode bugs (heading-wrap). | ~25s |
| `warehouse_a_5seeds` | warehouse_a × 5 seeds — quick statistical check. | ~25s |
| `warehouse_b_10seeds` | warehouse_b × 10 seeds — Priya's flow. | ~50s |
| `warehouse_c_10seeds` | warehouse_c × 10 seeds — long episodes. | ~4 min |
| `regress_default` | All 3 scenarios × 10 seeds = 30 runs. Run before merging. | ~5 min |
| `warehouse_b_proximity_bug` | **Bug scenario.** Sets `YARD_BUG_PROXIMITY_NAN=1`. Wheel commands go NaN within a few ticks. Used to test `/investigate`. | ~10s |

#### Yard's planted bugs

Yard ships three deliberately-broken code paths, gated behind env
vars (all off by default). Toggle them via `range.yaml` scenarios
or by setting the env var before launching `yard run`.

| env var | what it breaks | scenario you should investigate it from |
|---|---|---|
| `YARD_BUG_HEADING_DRIFT=1` | Skips angle-normalization in `pd_to_goal`. Mild signal — surfaces on long episodes. | `warehouse_c_10seeds` |
| `YARD_BUG_DEPTH_CLIP=1` | Engine clips depth at 0.45m instead of 0.05m. Bot doesn't see close walls. | `warehouse_b_10seeds` |
| `YARD_BUG_PROXIMITY_NAN=1` | "Stale sentinel" emits NaN wheel commands in narrow aisles. | `warehouse_b_proximity_bug` |

Full bug docs: `yard/HACKING.md`.

### 7.2 MuJoCo Playground scenarios (after Range scaffolds the yaml)

The Playground scaffold picks 3 representative envs out of the 54
available, biased toward the most-iterated starter tasks:

| scenario | env | category | what it trains |
|---|---|---|---|
| `g1_joystick_flat_terrain` | G1JoystickFlatTerrain | locomotion | Unitree G1 humanoid joystick locomotion on a flat plane |
| `aloha_hand_over` | AlohaHandOver | manipulation | Aloha dual-arm "pick up and hand over a cube" |
| `cartpole_balance` | CartpoleBalance | dm_control | Classic cartpole balancing — the cheapest first run |

You can add more by editing the generated `range.yaml`. The full
env list lives in `mujoco_playground/_src/{locomotion,manipulation,dm_control_suite}/__init__.py`.

### 7.3 Isaac Lab — detection only

Range's Isaac Lab detector finds 170+ registered tasks. It scaffolds
3 starter scenarios (`cartpole_direct`, `velocity_flat_anymal_d`,
`repose_cube_allegro_direct`), but **none of them run on Mac.** The
scaffold lands so you can ship the same `range.yaml` to a Linux box
later. Range will treat Isaac Lab as fully runnable in v0.7 once
remote execution lands.

---

## 9. Slash command reference

All slash commands appear in the picker (`/` in composer). Layer
badges:

- **range** (yellow): operations on the harness itself.
- **codex** (blue): operations on the Codex thread.
- **scenario** (blue-light): user-defined scenarios from `range.yaml`.
- **command** (neutral): user-defined commands from `range.yaml`.

### Range builtins

| command | what it does |
|---|---|
| `/pr` | Drafts a pull request from the current branch — opens an inline approval card you can edit before pushing. |
| `/restart` | Kills Codex and starts a fresh thread with the current session config. Conversation history stays. |
| `/clear` | Archives history + restarts Codex + wipes the chat. (Runs and artifacts are preserved.) |
| `/investigate [run-id]` | NaN/instability flow. Auto-picks the latest failed run if no id given. Sends Codex a structured trajectory report + investigation directives. |
| `/wire wandb-hydra` | Scans the repo for Hydra + W&B and patches the canonical broken patterns (missing `start_method="thread"`, DictConfig passed unconverted, etc.). Inline approval card with per-file diffs. |
| `/eval <checkpoint-path> [scenario]` | Re-runs a scenario with `RANGE_CHECKPOINT=<path>` env injected. Your training script reads it and loads weights instead of training from scratch. |
| `/reward show <name>` | Surfaces the source code of a declared reward function inline (name comes from the `reward_functions:` block of `range.yaml`). |
| `/obs <run-id> <step>` | Dumps the observation vector at a specific tick of a run as a JSON block. |

### Agent-native commands

Each backend can expose its own slash commands. They appear in the
picker with a backend-named badge (e.g., green `opencode`).

**OpenCode** (badge: `opencode`):

| command | what it does |
|---|---|
| `/init` | OpenCode scans the repo and generates an `AGENTS.md` context file it uses for grounding on every turn. |
| `/undo` | Reverts the last assistant action (finds the most recent assistant message and reverts to it). |
| `/redo` | Re-applies the last reverted action. |
| `/share` | Creates a publicly-shareable URL for this session (requires OpenCode sharing service auth). |
| `/unshare` | Removes the session's public share. |
| `/shell <command>` | Runs a shell command directly in the session worktree, no LLM needed. Output streams into the next message. |
| `/fork` | Forks this session into a new OpenCode session inheriting the conversation. |

**Codex** doesn't currently expose its TUI slash commands via the
`app-server` JSON-RPC schema. The Codex slash items shown above
(`/model`, `/compact`, etc.) are Range-managed, cross-backend
shortcuts that talk to Codex's existing thread/turn APIs. When
Codex's app-server adds a command catalog endpoint, Range will
surface those automatically.

### Codex builtins

| command | what it does |
|---|---|
| `/model <name>` | Switches LLM mid-session (e.g. `/model claude-sonnet-4.5`). Restarts Codex thread. |
| `/think low\|medium\|high` | Sets reasoning effort. Restarts thread. |
| `/sandbox read-only\|workspace-write\|danger-full-access` | Changes Codex's filesystem access. Restarts thread. |
| `/approvals on\|off` | Toggles per-tool-call approvals. When off, Codex auto-approves everything (use with sandbox tightened). |
| `/compact` | Summarizes earlier turns to save context tokens. |
| `/tokens` | Shows current thread token usage (in/out/reasoning + context window). |
| `/diff` | Shows the current turn's aggregated unified diff (what Codex edited so far). |

### Scenarios & commands

Whatever's in `range.yaml`. Type `/` and they appear with a
scenario or command badge respectively. Pick one and it runs.

---

## 10. Investigation flows

### 9.1 NaN / instability investigation (P2)

**When to use it:** A run finished in `failed` state and you don't
yet know why. The first thing to check is whether NaN crept in.

**How:**

1. Run any scenario; it fails.
2. Type `/investigate`. Range:
   - Looks up the latest failed run for this session.
   - Walks the run's `events.jsonl`, filtering to trajectory ticks.
   - Identifies the first NaN/Inf tick + which field went bad.
   - Captures the 5 ticks immediately before contamination (so
     Codex sees "what the world looked like just before things
     went sideways") + the first 5 contaminated ticks.
   - Builds a markdown report + investigation directives, sends
     it to Codex as a user message.
3. Codex investigates — typically reads the relevant code file,
   forms a hypothesis, proposes a fix.

**You can also use it from the CLI directly:**

```bash
range trajectory inspect <run-id>
```

Useful inside Codex (which has the `range` CLI on PATH), or for
your own quick checks.

### 9.2 Hydra + W&B wiring (P3)

**When to use it:** You've attached a repo that uses both Hydra and
W&B, and (a) `wandb.init` is hanging when launched via Hydra, or
(b) W&B is logging garbage configs ("DictConfig is not JSON-
serializable"), or (c) you just want to preemptively patch the
known foot-guns.

**How:**

1. Type `/wire wandb-hydra`.
2. Range scans the repo's `.py` files (skipping `.venv`, `__pycache__`,
   etc.). It detects:
   - `@hydra.main` decorators or `OmegaConf`/`DictConfig` use.
   - `wandb.init(...)`, `wandb.config.update(...)`, `wandb.config = ...`.
3. For each W&B-using file, it generates a patch that:
   - Injects `settings=wandb.Settings(start_method="thread")` into
     any `wandb.init(...)` missing it.
   - Wraps `config=...` arguments and `wandb.config.update(...)`
     arguments with `OmegaConf.to_container(..., resolve=True)`.
   - Adds `from omegaconf import OmegaConf` if not present.
4. An inline approval card shows each affected file + a per-file
   change list + a preview of the patched content. Accept to write.

The patcher is regex-driven but masks out docstrings and comments
so the call patterns inside them don't trigger false positives.

### 9.3 Checkpoint A/B (P4)

**When to use it:** You have two trained checkpoints and want to
compare their performance on the same scenario.

**How:**

```
/eval /path/to/checkpoint_a.pkl cartpole_balance
/eval /path/to/checkpoint_b.pkl cartpole_balance
```

Range runs both with `RANGE_CHECKPOINT=<path>` set. Your training
script needs to read that env var — by convention, scripts check
`RANGE_CHECKPOINT` and if set, load the policy from there instead of
random init. Both runs appear as cards in the timeline; click into
each to see metrics.

(Note: v0.5 does the launch + record; the explicit side-by-side
diff card is on the roadmap.)

### 9.4 Live plan + trajectory scrubber (P5)

**When to use it:** Codex is in the middle of a multi-step task and
you want to see the plan as it works. Or: a scenario produced a
trajectory artifact and you want to scrub through it visually.

**Live plan tracking** is automatic. Whenever Codex emits a plan via
its `update_plan` tool, a checklist appears pinned at the top of the
current turn — `pending` items in muted grey, `in_progress` pulsing
blue, `completed` items struck through in green. No action needed.

**Trajectory scrubber** appears as a "📈 view trajectory" button on
any run that produced a `trajectory.npz` artifact. Click it:

- The server downsamples to 2000 points (so the viewer stays
  responsive even for million-tick trajectories).
- One SVG panel per 1D field — `t`, `x`, `y`, `yaw`, `speed`,
  `ctrl[0]`, `ctrl[1]`, `min_depth`, `collided`, etc.
- A vertical cursor follows your mouse across all panels in sync.
  The right edge of each panel shows the value at the cursor + the
  field's full [min, max] range.
- NaN/Inf entries render as gaps in the line — instantly visible
  where things went wrong.

For one-off lookups: `/obs <run-id> <step>` dumps the full
observation vector at any tick as a JSON block inline. Useful when
Codex is investigating and asks you "what did pose look like at tick
1,447?"

### 9.5 Reward function inspection (P4)

**When to use it:** You want to read what `_reward_tracking_lin_vel`
actually does without leaving Range.

**How:**

```
/reward show g1_joystick_flat_terrain__tracking_lin_vel
```

Inline system message appears with the function source extracted
from `mujoco_playground/_src/locomotion/g1/joystick.py`, rendered as
syntax-highlighted Python via the markdown renderer.

The names come from the `reward_functions:` block Range scaffolded
into your `range.yaml`. You can add more entries by hand — point
`name`/`file`/`function` at any reward method on disk.

---

## 11. Where things live (file map)

```
~/personal/range/
├── web/
│   ├── server/             # Bun + Hono backend
│   │   ├── index.ts          # routes + WS hub
│   │   ├── codex.ts          # Codex subprocess + JSON-RPC plumbing
│   │   ├── scaffold.ts       # P1 — auto range.yaml
│   │   ├── trajectory.ts     # P2 — NaN inspector
│   │   ├── wire.ts           # P3 — Hydra+W&B patcher
│   │   ├── runner.ts         # spawns + tracks scenario runs
│   │   ├── runs.ts           # SQLite run rows
│   │   ├── sessions.ts       # SQLite session rows
│   │   ├── profile.ts        # range.yaml parser
│   │   └── ... (verification, pr, fs_browse, db, hub, log)
│   ├── src/                # React 19 frontend
│   │   ├── views/SessionView.tsx   # the main chat + composer + cards
│   │   ├── views/Home.tsx          # session list + new-session composer
│   │   ├── lib/store.ts            # Zustand store
│   │   ├── lib/ws.ts               # WebSocket dispatcher
│   │   ├── lib/api.ts              # REST helpers
│   │   └── views/Markdown.tsx      # ReactMarkdown wrapper
│   ├── cli/range.ts        # the `range` CLI Codex calls into
│   ├── shared/protocol.ts  # the WS/REST type contract
│   ├── tests/fixtures/     # canonical broken setups for /wire etc.
│   └── package.json
└── docs/
    ├── user_guide.md            ← you are here
    ├── dev_setup.md
    ├── range_product_spec_v0_5_sim_engineer_workflow.md
    ├── direction_2026_05_15.md
    ├── direction_2026_05_14.md
    └── ... (other specs)

~/personal/yard/
├── yard/                   # the actual sim
│   ├── engine/             # MuJoCo wrapper, sensors, recorder
│   ├── apps/               # scenarios, controllers, eval, regression
│   └── cli.py
├── tools/range_shim.py     # forwards Range env vars into yard CLI
├── range.yaml              # what Range orchestrates
├── HACKING.md              # planted bug catalog
├── ELI5.md                 # what robot-sim engineering looks like
├── ELI5_FOUNDATIONS.md     # math + physics + neural nets refresher
└── README.md

~/.range/                   # runtime state, gitignored
├── range.db                # sessions, runs, attempts
├── threads/<sessionId>/    # Codex per-session events.jsonl
├── worktrees/<sessionId>/  # git worktrees Codex edits in
└── runs/<runId>/           # per-run artifacts (metrics.json, events.jsonl, trajectory.npz, replay.mp4, depth_frames/)
```

---

## 12. Glossary

| term | meaning |
|---|---|
| **MJX** | MuJoCo's JAX-compatible backend. Runs on GPU/TPU, vectorizes across thousands of envs. |
| **Brax** | Google's RL training library built on JAX. PPO, networks, training utilities. |
| **PPO** | Proximal Policy Optimization. The most common RL algorithm. |
| **Domain randomization** | Varying sim parameters (mass, friction, contact margin) so trained policies survive on real hardware. |
| **Reward shaping** | Editing the reward function to make training easier. Most of the iteration in RL. |
| **Sim-to-real** | The gap between behavior in sim and on a physical robot. The hard problem. |
| **Rollout** | Codex term for the persisted state of a conversation thread. Stored under `~/.codex/sessions/`. |
| **Sweep** | One scenario fanned out across multiple seeds or hyperparameter combos. |
| **Worktree** | Range creates a `git worktree` per session so Codex's edits don't interfere with your working directory. |

---

## 13. Pointers for further reading

**Inside the repo:**

- `docs/range_product_spec_v0_5_sim_engineer_workflow.md` — the
  full v0.5 product spec, audience analysis, prioritized roadmap.
- `docs/range_positioning_v0_1.md` — Range's NVIDIA-independent
  positioning rules.
- `yard/ELI5.md` — long-form "what is robotics simulation"
  introduction.
- `yard/ELI5_FOUNDATIONS.md` — math/physics/neural-net refresher.
- `yard/HACKING.md` — planted bug catalog with investigation flows.

**Outside the repo:**

- [MuJoCo docs](https://mujoco.readthedocs.io/) — the physics
  engine Yard and Playground both use.
- [MuJoCo Playground tech report (Jan 2025)](https://arxiv.org/abs/2502.08844)
  — what it covers and why it exists.
- [Isaac Lab docs](https://isaac-sim.github.io/IsaacLab/) — NVIDIA's
  full-stack sim framework. Not Mac-runnable.
- [Brax](https://github.com/google/brax) — the JAX-based RL library
  Playground's training scripts use.
- [Hydra docs](https://hydra.cc/) — the config framework.
- [Weights & Biases](https://wandb.ai/) — the experiment tracker.

---

## Quick troubleshooting

| symptom | cause | fix |
|---|---|---|
| Many `codex app-server` processes running | Pre-v0.5 behavior. Lazy-start + idle-shutdown is now in. | They reap themselves after 20 min idle. Restart the dev server to clear leftovers. |
| `range.yaml` doesn't get scaffolded | A `range.yaml` already exists in the repo. Range doesn't overwrite. | Delete it, then attach again — or use `/scaffold/preview` via curl. |
| `uv sync` fails on jaxlib | Default Python is too new (3.14). | The scaffold pins `--python 3.13`; if you accept the scaffold first this is solved. |
| `python: command not found` when launching a scenario | macOS only has `python3`. | The scaffold emits `uv run python ...` — accept it. |
| `/investigate` says "no failed run found" | You haven't run anything that failed yet, or the session has none. | Run a buggy scenario first (e.g. `/warehouse_b_proximity_bug`), or pass an explicit `<run-id>`. |
| Browser tab is stale after a server-side change | Vite serves the frontend; Bun --hot reloads the server. Sometimes the frontend doesn't see the server change. | Hard-refresh the browser tab. |

---

End of user guide. Improvements welcome — this doc lives at
`docs/user_guide.md`.
