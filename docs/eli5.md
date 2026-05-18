# ELI5 — robot sim from first principles

A doc in two halves:

1. **Part 1 — ELI5 for a software engineer who's never touched
   robotics.** Walks through a tiny worked example end-to-end and
   explains the concepts from first principles.
2. **Part 2 — A robot-sim engineer's tutorial.** The concepts,
   tools, workflows, buzzwords, and gotchas you need to be
   credible at this in a few hours of reading.

> **Note on the running example:** Part 1 uses **Yard** — a ~1,400-line
> Python toy sim Range was originally pair-built with — as the
> concrete codebase. Yard has since been retired as Range's public
> demo substrate (we use MuJoCo Playground now), but it's still the
> clearest way to explain the fundamentals because the whole thing
> fits in your head. Where concepts map differently to Playground
> or Isaac Lab, Part 2 calls it out.

---

# Part 1 — What is Yard?

## The one-sentence pitch

Yard is a tiny **fake world** where a tiny **wheeled robot** tries
to **drive from one corner of a room to another corner without
bumping into stuff** — and we use that fake world to teach you
what robot-sim engineers actually do all day.

That's it. The whole codebase is ~1,400 lines of Python and XML.

## Why is "fake world" the interesting part?

Real robots are:

- **Expensive.** A small humanoid is $20k-$200k. A research arm
  is $5k-$50k.
- **Slow.** One trial run takes minutes. Setup takes hours.
- **Fragile.** Crash a robot into a wall, you're calibrating
  motors for the rest of the week.
- **Hard to reproduce.** "It works on my robot" is even worse
  than "it works on my machine."

A simulator solves all four. It runs faster than real time, costs
nothing per trial, never breaks, and produces the **same trajectory
given the same random seed**. You can run 1,000 attempts in the
time a real robot does 10.

That's the whole game. Everything else in robot sim is in service
of "make the fake world feel close enough to the real one that
what you learn here transfers."

## What's actually inside Yard?

Six concepts. None of them are exotic.

### 1. The world (MJCF)

Look at `assets/warehouse_a.xml`. That XML describes a 6m × 6m room
with four boxes scattered around. It's a scene file — like a level
file in a game engine, but written in **MJCF** (MuJoCo's flavor of
XML).

MJCF has three kinds of stuff in it:

- **Bodies** — physical things with mass and inertia (the chassis,
  the wheels, the obstacles).
- **Joints** — how bodies move relative to each other (the wheels
  rotate on hinges; the chassis floats freely in 3D).
- **Sensors / actuators / cameras** — devices attached to bodies.
  We have a velocity motor on each wheel and a forward-facing
  depth camera on the chassis.

The whole MJCF for one scenario is ~100 lines. You can read it.

### 2. The physics engine (MuJoCo)

MuJoCo is the program that reads MJCF and **integrates Newton's
laws forward in time**. Every 5 ms of sim time, MuJoCo:

- Computes contact forces (which bodies are touching?)
- Computes joint torques (what are the motors trying to do?)
- Updates positions and velocities of every body

You don't write any of this physics code. You write MJCF
(declarative: "here are the bodies, here are the constraints") and
MuJoCo handles the rest.

We use MuJoCo because it's free (Apache 2), fast on a Mac without a
GPU, and has a great Python API. The alternatives — PhysX, Bullet,
Drake, Gazebo, Genesis — all do roughly the same thing with
different tradeoffs.

### 3. The sensor (a depth camera)

Real robots can't read the world's ground-truth state. They have
sensors that give them noisy, partial views.

In Yard, the only sensor is a depth camera. It's a 64×48 grid where
each pixel is "how many meters until the ray from this pixel hits
something." MuJoCo renders this for us with the same offscreen-GL
pipeline that renders the replay video — we just enable depth mode.

You can see what the bot sees: every run dumps a bunch of PNGs into
`depth_frames/`. Open one. The black areas are "far away" and the
bright areas are "close to an obstacle."

### 4. The controller (`pd_to_goal`)

The controller is the **brain**. It reads the sensor + the
bot's pose, and writes wheel velocities. Yard's controller is dumb
on purpose: ~100 lines that say "turn toward the goal; slow down if
something is in front of you; steer away if something is close to
the left/right side."

This is a **PD controller** — proportional-derivative — a
50-year-old classical control technique that's still the
controller most robots in the wild use. The "P" part: how much
omega to command is proportional to how wrong your heading is.

Modern controllers replace PD with **RL policies** (a neural net
trained to maximize reward) or **MPC** (re-solving an optimization
problem each tick). Yard skips those entirely. The point isn't the
controller — it's everything around it.

### 5. The task / scenario (`warehouse_a`)

A scenario is: "where does the bot start, where does it need to
go, when does it count as success, when does it count as failure,
how long do you have."

```python
WAREHOUSE_A = Scenario(
    name="warehouse_a",
    scene_xml=ASSETS / "warehouse_a.xml",
    goal_tolerance_m=0.30,
    timeout_s=20.0,
    description="Open 6×6m floor with 4 scattered boxes.",
)
```

Three scenarios in Yard:

- `warehouse_a` — open floor with scattered boxes (easy)
- `warehouse_b` — narrow aisle (medium, controller has to steer)
- `warehouse_c` — long path (slow, surfaces timing bugs)

### 6. The eval (`yard eval` and `yard regress`)

Single-seed runs lie. Random initial perturbation (we jiggle the
start position by a few cm) means the bot might succeed on seed 42
and fail on seed 43.

**Multi-seed eval** is the only honest metric. Run the same
scenario across 10 seeds, count how many succeed, that's your
success rate. Yard's `eval_seeds` does exactly this and writes a
`summary.json`.

The **regression suite** is one level up: run every scenario over
every seed and compute a single number for the whole suite. Yard
calls `yard regress --suite default` to do this; it gives you
"96.67%" which is "29 of 30 runs succeeded." That number is what
you watch as you change code. If it drops, you broke something.

## What does a run actually produce?

When `yard run --scenario warehouse_a --seed 42` finishes, it
writes a `runs/warehouse_a-seed042-<timestamp>/` directory:

```
events.jsonl       per-tick: pose, velocity, controller action,
                   sensor reading, collision flag. Append-only.
trajectory.npz     same data as numpy arrays for plotting.
depth_frames/      a depth PNG every 40 ticks.
replay.mp4         top-down camera, 30fps, mp4-encoded.
metrics.json       { success: true, ttg_s: 14.5, collisions: 0, … }
config.yaml       exact config used (seed, scenario, code SHA).
```

The pattern matters: **a run is a directory, not a number**.
Anything you'd want to inspect post-mortem is on disk, structured,
parseable. This is what makes "investigate why seed 43 failed"
possible.

## How does a single run actually happen?

A "run" is one episode of the bot trying to reach the goal.
Mechanically, it's a tight loop between two things: **the brain
(controller / policy)** and **the gym (env)**. The gym holds the
world. The brain decides what to do. They take turns:

```
  brain (controller)                gym (env: world + physics)
  ────────────────────              ─────────────────────────────
       │                                       │
       │     env.reset(seed=42)                │
       │ ─────────────────────────────────────▶│
       │                                       │  • build world
       │                                       │  • place bot, jiggled by seed
       │                                       │  • render initial depth image
       │                                       │
       │      obs₀ = (depth_img, pose, goal)   │
       │ ◀─────────────────────────────────────│
       │                                       │
       │  ┌────────────────────────┐           │
       │  │ action₀ = brain(obs₀)  │           │
       │  │  e.g. wheel velocities │           │
       │  └────────────────────────┘           │
       │                                       │
       │            action₀                    │
       │ ─────────────────────────────────────▶│
       │                                       │  • apply motors
       │                                       │  • mj_step → 5ms of physics
       │                                       │  • re-render sensors
       │                                       │  • check: collided? at goal?
       │                                       │  • compute reward₀
       │                                       │
       │  obs₁, reward₀, done?, info           │
       │ ◀─────────────────────────────────────│
       │                                       │
       │     action₁ = brain(obs₁)             │
       │ ─────────────────────────────────────▶│
       │                                       │
       │              … repeat …               │
       │                                       │
       │     done = True (success or fail)     │
       │ ◀─────────────────────────────────────│
       │                                       │
       └─ Episode is over.                     │
          We have the full trajectory:
          [(obs₀,action₀,reward₀), (obs₁,action₁,reward₁), ...]
          plus a final outcome (success / collision / timeout).
```

Three things to notice:

1. **The brain is stateless from the env's perspective.** It gets
   an `obs` in, returns an `action` out. (Internally the brain
   might keep its own memory — a hidden state, a buffer of past
   frames — but the env doesn't know or care.)
2. **The env is the one that knows physics.** The brain doesn't
   simulate gravity or contact. It just commands wheels and reads
   sensors. That separation is what makes it possible to swap a
   PD controller for a neural net without touching MuJoCo.
3. **Each tick is "one frame" of decision-making.** Yard ticks at
   200 Hz (5 ms per physics step). A 14-second episode is ~2800
   decisions. The brain plays a long, fast game.

In Yard's code today, `run_once` in `yard/apps/eval.py` is exactly
this loop. We don't emit `reward` because the PD controller doesn't
need one — it follows hand-coded rules. The moment we want to train
an RL policy, we add a `reward` term and the loop is unchanged.

---

## The reward function — the most important file in the repo

If you only learn one thing about RL, learn this: **the reward
function is the spec for what the robot will do**. The brain has no
idea what "reach the goal" means. It only sees a scalar number
arriving every tick, and over millions of episodes it learns to
take actions that make that number bigger.

So whatever you put in the reward function — exactly what you put,
not what you meant — is what you get.

### What a reward function looks like for Yard

A reasonable reward for our diff-drive bot:

```python
def reward(obs, action, info) -> float:
    r = 0.0
    r += +10.0  if info["reached_goal"]   else 0.0    # success
    r += -5.0   if info["collided"]       else 0.0    # punishment
    r += -0.01                                         # per-tick "hurry up"
    r += -0.5 * info["dist_to_goal_delta"]            # dense reward: get closer
    r += -0.001 * abs(action[0] - action[1])          # smooth wheels
    return r
```

Five lines. Each line is a *value statement*:

- `+10 success` — reaching the goal matters most
- `-5 collision` — hitting things is bad, but worth risking if you'll succeed
- `-0.01/tick` — don't take 30 seconds when you could take 10
- `-0.5 * dist_delta` — every step closer is good; every step away is bad
- `-0.001 * wheel_difference` — slightly prefer smooth driving over wild swerves

Tuning those five numbers — their signs, magnitudes, and whether
they exist at all — is most of the work of "training an RL bot."

### Why this is hard: reward hacking

The brain *will* find the cheapest possible way to maximize your
reward, even if you didn't mean what you wrote. Some classic
real-world failures:

- Reward = "distance traveled." Result: bot spins in tight circles
  forever, racking up distance, never reaching the goal.
- Reward = "−distance to goal at each tick." Result: bot drives to
  goal, then drives away, then drives back, oscillating forever.
  (Fix: only give negative reward for distance, never positive.)
- Reward includes "energy efficiency." Result: bot stands still
  forever, infinite efficiency.
- Reward = "+1 for picking up the cube." A famous OpenAI experiment:
  bot learned to flip the cube over rapidly so the contact sensor
  thought it had picked it up many times in a row.

There's a saying: *"The reward function is a contract you negotiate
with a literal-minded sociopath."* The brain isn't malicious — it's
just very good at optimizing exactly what you wrote.

### Dense vs sparse reward

- **Sparse reward** = "+10 only on success, 0 the rest of the time."
  Honest but hard to learn from — the brain spends thousands of
  episodes flailing before it ever sees a non-zero signal.
- **Dense reward** = "small +/− every tick based on progress."
  Faster learning but vulnerable to reward hacking and to local
  optima.

Most production reward functions are dense for the easy stuff (get
closer to goal, stay upright, don't waste energy) and sparse for the
hard win-condition (you succeeded or you didn't).

### Why this section exists

In Yard right now we don't have an RL policy, so we don't have a
reward function. But the moment we add one — even a 5-line one — it
becomes the single most consequential file in the repo. More
important than the network architecture, more important than the
optimizer, more important than the scene geometry. Every other
choice is in service of "this number, optimized."

---

## How does a neural-net brain get trained?

OK so we have an env, a brain, and a reward signal. How does the
brain *get good*?

Training is a loop. One full cycle is called an **iteration** (or
sometimes an *update*). You do it 100,000 to 10,000,000 times.

### The training loop in pictures

```
            ┌────────────────────────────────────────────┐
            │  1. ROLLOUT                                │
            │  ─────────                                 │
            │  Take the current brain (randomly init'd   │
            │  on iteration 0, slightly better each      │
            │  iteration after that).                    │
            │                                            │
            │  Run it across N parallel envs.            │
            │  Each env starts with a fresh seed.        │
            │                                            │
            │  Record every (obs, action, reward, done)  │
            │  tuple. Maybe 100,000 of them per          │
            │  iteration across all envs.                │
            └──────────────────┬─────────────────────────┘
                               │
                               ▼
            ┌────────────────────────────────────────────┐
            │  2. ATTRIBUTE                              │
            │  ─────────                                 │
            │  For every (obs, action) pair, ask:        │
            │                                            │
            │    "Looking at the rewards that came       │
            │     AFTER this action, was this action     │
            │     better or worse than what the brain    │
            │     would normally pick in this state?"    │
            │                                            │
            │  That answer is called the ADVANTAGE.      │
            │   advantage > 0  → this action was good    │
            │   advantage < 0  → this action was bad     │
            └──────────────────┬─────────────────────────┘
                               │
                               ▼
            ┌────────────────────────────────────────────┐
            │  3. GRADIENT STEP                          │
            │  ─────────                                 │
            │  This is the actual "learning."            │
            │                                            │
            │  Compute a loss like:                      │
            │    loss = − Σ  advantage · log π(action|obs)│
            │                                            │
            │  Then update weights:                      │
            │    weights ← weights − lr · ∇loss          │
            │                                            │
            │  Translation:                              │
            │    if advantage > 0, nudge weights so      │
            │    that this action becomes MORE likely    │
            │    in this observation.                    │
            │    if advantage < 0, MAKE IT LESS LIKELY.  │
            │                                            │
            │  Tiny per-step change. ~0.0001 of a nudge. │
            └──────────────────┬─────────────────────────┘
                               │
                               ▼
            ┌────────────────────────────────────────────┐
            │  4. LOOP                                   │
            │  ─────────                                 │
            │  The brain's weights have changed slightly.│
            │  The next rollout will use the new brain,  │
            │  which is a tiny bit better (in expectation)│
            │  than the previous one.                    │
            │                                            │
            │  Repeat 100k - 10M iterations.             │
            └──────────────────┬─────────────────────────┘
                               │
                               └────────────► back to step 1
```

The whole training run might be:

- 10,000,000 sim ticks across 4,096 parallel envs
- ~2,400 iterations of the loop above
- 12 hours of wall clock on a single GPU
- Result: one `policy.pt` file, ~1 MB of weights

### Where the reward function lives in this loop

In **step 2** — the *attribute* phase. The advantage of an action
is computed from the rewards that came after it. If your reward
function says "+10 for reaching the goal," then any sequence of
actions that ended at the goal gets positive advantage spread
backward through it (via something called Generalized Advantage
Estimation, GAE — don't worry about the math). Those actions become
more likely.

If your reward function is wrong, the advantage is computed against
the wrong signal, and the policy gets very good at the wrong thing.
This is why everyone says "the reward function is the spec."

### What changes during training, in detail

The brain is a neural network — a function `π(obs) → action`. It
has thousands or millions of weights. Initially those weights are
random Gaussian noise, so the brain picks random actions and crashes
into walls.

Each gradient step nudges every weight by a tiny amount in the
direction that increases the expected reward. The first few thousand
iterations look like statistical noise. Then somewhere around
iteration 10,000, the average episode reward starts creeping up. By
iteration 100,000 the bot reliably moves toward the goal. By
iteration 1,000,000 it threads aisles and avoids obstacles with
~99% success. That curve — average reward over training iterations
— is the canonical chart you see in RL papers. It's called the
**learning curve** and you watch it like a hawk.

### "Eval" vs training, the actual difference

These are two different uses of the same env:

- **Training mode**: the brain is *changing*. Every rollout's data
  feeds back into the weights. The brain might do dumb things —
  exploration is intentional.
- **Eval mode**: the brain is *frozen* (no gradient updates). You
  run it across a fixed set of seeds and just measure success rate.
  That number tells you whether training is going somewhere.

You typically train for a while, pause to eval on held-out seeds,
plot the eval success rate alongside the training reward curve, and
decide when to stop. (Stop too early: undertrained brain. Train too
long: starts overfitting to quirks of the sim that won't transfer.)

In Yard right now, `yard eval` and `yard regress` are the **eval
mode** half of this loop — we're evaluating a frozen, hand-coded
brain (`pd_to_goal`). We never go into training mode. The moment we
swap `pd_to_goal` for a neural net, we'd add a training script
(probably ~300 lines of PyTorch or JAX) that does the loop above.
The eval code wouldn't change.

### The whole thing in one diagram

```
                          ┌──────────────────────┐
                          │   reward function    │
                          │   (5 lines of code)  │
                          └─────────┬────────────┘
                                    │ defines "good"
                                    ▼
   ┌──────────┐   action    ┌─────────────────┐
   │  brain   │ ──────────▶│   gym (Yard)    │
   │  π(obs)  │            │   physics + bot  │
   │ weights  │ ◀──────────│   + sensors     │
   └────┬─────┘  obs,      └─────────────────┘
        │        reward
        │
        │   collect ~100k (obs, action, reward)
        │   tuples per iteration
        │
        ▼
   ┌──────────────────────────────────┐
   │ PPO / SAC / your favorite RL algo│
   │                                   │
   │  • compute advantage             │
   │  • compute loss                  │
   │  • gradient step on weights      │
   └──────────────┬───────────────────┘
                  │
                  │  updates weights by tiny amount
                  │
                  └────────► back into brain π
                            (loop ~1M times)
```

That's it. That's the entire deep-RL robotics pipeline. Every
fancy paper you'll read — PPO, SAC, DreamerV3, model-based RL,
diffusion policies — is some variant of "make step 2 or step 3
smarter." The shape of the loop is the same.

---

## What's the deal with the bugs in `HACKING.md`?

We **planted two realistic bugs** behind environment variables.
Both are off by default. Both produce a regression we can
investigate with an agentic harness (Range, in the sibling repo).

- `YARD_BUG_HEADING_DRIFT` — skips angle normalization in the
  controller. Mostly invisible; mild on `warehouse_c`.
- `YARD_BUG_DEPTH_CLIP` — engine returns "infinity" for any depth
  closer than 0.45 m. Catastrophic: bot can't see close obstacles,
  drops the suite from 96 % to 50 %.

The bugs exist so we can practice the **investigation flow** with
Range: "the regression dropped — figure out why." That's the loop
Range is built to make fast.

---

# Part 2 — Become a robot-sim engineer in one read

Everything below is field knowledge. Skim, anchor to what we built
in Yard, look up the buzzwords later.

## What does a robot-sim engineer actually do?

Three personas blur into each other:

1. **Scene / asset author.** Builds the worlds the robot operates
   in. MJCF, URDF, USD, Blender. Spends time on geometry, friction
   parameters, lighting (if rendering matters).
2. **Controls / policy author.** Writes the controller that drives
   the robot. PD, MPC, RL — depends on the team. Spends time
   tuning gains, designing reward functions, training models.
3. **Eval / infra author.** Builds the harness that runs scenarios
   over seeds, computes success rate, catches regressions, ships
   reports. **Range is for this person.** Yard's `eval` / `regress`
   modules are this person's job in miniature.

Most "sim engineers" do all three at different ratios depending
on team size and seniority.

## The day-to-day loop

```
┌─ author or modify a scene / controller / scenario
│
├─ run a single seed, watch it (replay.mp4 or live viewer)
│  → did anything obvious break? geometry penetrating? bot
│    floating? motors saturating?
│
├─ run a small sweep — 5-10 seeds. compute success rate.
│  → is the success rate moving in the right direction?
│
├─ inspect failures. what seed failed? at what time-step? what
│  was the sensor reading just before? load `events.jsonl`,
│  scrub the replay, plot a trajectory.
│
├─ propose a fix (tune a gain, fix a sign, adjust a threshold,
│  change the reward, modify the scene).
│
├─ re-run the same sweep. did the regression go away? did
│  anything else break?
│
└─ once you're convinced, run the full regression suite, file
   the change, move to the next thing.
```

Yard is built around this loop. So is Range. Once you've done it
50 times you stop thinking about the steps.

## The physics engine zoo

You will hear these names. Don't get attached to any one of them —
they all simulate Newtonian rigid-body physics, they just have
different cultures.

| engine     | culture                                       | when used                                                |
|------------|-----------------------------------------------|----------------------------------------------------------|
| **MuJoCo** | Google DeepMind, research-friendly, fast      | Default for most RL/research sim today. What we use.    |
| **Bullet** | Game engine roots, easy, less accurate        | Education, simple sims (PyBullet, Roboschool).          |
| **PhysX**  | NVIDIA, GPU-accelerated, used by Isaac Sim    | Photo-real industrial sim, manipulation, large worlds.  |
| **Drake**  | Toyota Research, formally-rigorous, slow      | Manipulation, contact-rich tasks, control theory work.  |
| **Gazebo** | ROS 2 standard, photo-real, heavy             | Anything in the ROS ecosystem, multi-robot.             |
| **Genesis**| New (2024), claims fastest + differentiable   | Cutting-edge research, untested in production.          |
| **Newton** | NVIDIA's open re-implementation of physics    | New, GPU-accelerated, ties into Warp/MJX/Drake.         |
| **MJX**    | MuJoCo on JAX/GPU — same model, vectorized    | Massive-parallel RL training (thousands of envs at once).|

What you actually need to know: pick MuJoCo unless someone forces
your hand. It's the lingua franca for academic and small-team
robotics in 2026.

## Scene-description formats

These are the file formats that say "here's the world and here's
the robot."

| format     | who uses it                          | how it feels                                  |
|------------|--------------------------------------|-----------------------------------------------|
| **MJCF**   | MuJoCo                               | Compact, hand-authorable, fast.               |
| **URDF**   | ROS, Drake, Bullet, Isaac            | Verbose XML, defines robots not scenes. Everyone has one.|
| **USD**    | NVIDIA, Omniverse, Pixar             | Powerful but heavy. Scene-graph-y.            |
| **SDF**    | Gazebo                               | Like URDF + scene wrapper.                    |
| **OnShape / Fusion** | CAD-first orgs              | Export to URDF; not used at runtime.          |

Files conventionally describe a **kinematic tree**: a root body
with children. Each link has mass, inertia, collision geometry
(simple shapes — boxes, cylinders, meshes), and visual geometry
(prettier). Each joint constrains how a child moves relative to its
parent — hinge, slide, ball, free.

The robot in `warehouse_a.xml`: the chassis is the root (a free
joint, so it can move anywhere in 3D), with the left wheel, right
wheel, and caster as children attached by hinges and a fixed
attachment respectively.

## Sensors

Sim engineers obsess over sensors because **policies trained on
zero-noise simulated sensors do not transfer to real hardware**.
Every sensor in real life is noisy, biased, and dropout-prone.

Common simulated sensors:

| sensor | what it gives | gotchas                                       |
|--------|---------------|-----------------------------------------------|
| **Depth camera** | per-pixel distance | Near-plane clipping; quantization noise; works poorly at glass / shiny surfaces in real life. |
| **RGB camera**   | image           | Photo-real rendering is expensive; lighting mismatches kill transfer. |
| **LiDAR**        | sparse 3D points | Models geometry well, but real LiDAR misses dark / reflective surfaces. |
| **IMU**          | linear acc + angular vel + orientation | Drifts in real life; needs noise + bias modeling. |
| **Joint encoders** | per-joint position | Cheap, accurate, basically transfer-free. |
| **Force-torque** | wrench at a body | Hard to sim because contact forces are stiff. |

Yard has one: a depth camera. We render at 64×48 because that's
enough for the simple obstacle-distance rule we wrote, and tiny
sensors keep training fast.

## Controllers, from cheap to expensive

| controller | what it is | when it's the right choice                        |
|------------|------------|----------------------------------------------------|
| **PID** (and PD) | Closed-loop feedback: error → correction | Stable, well-understood, no learning. **Yard uses PD.** |
| **MPC** (model-predictive control) | Solve an optimization problem each tick over a short horizon | When you have a model + need optimal behavior + can afford the compute. |
| **Trajectory optimization** | Solve an optimization problem once, replay the result | Pre-planned motions: walking gaits, manipulation primitives. |
| **Behavior cloning** | Imitate human demonstrations | When you have demos and the task is hard to specify with reward. |
| **RL** (PPO, SAC, DDPG…) | Train a neural net to maximize reward | When you have a reward function and lots of sim compute. The whole "humanoid that walks" space. |
| **Diffusion / VLA policies** | Generative models conditioned on observations + language | Latest hotness for general-purpose manipulation. Hard to train, hard to debug. |

What everyone is converging on in 2026: RL or diffusion policies
trained in massively-parallel sim (think 8,192 environments at
once on a GPU), validated against MPC baselines, then sim-to-real
transferred with domain randomization + system ID.

## Reward, reset, success — the RL trinity

If you train policies with RL, three things define your problem:

- **Reward function** — per-tick scalar telling the policy what's
  "good." Designing this well is the whole job. Sparse reward
  ("+1 when you reach the goal, 0 otherwise") is honest but hard
  to learn from. Dense reward ("a tiny positive for getting closer
  to the goal each tick") learns faster but is easy to game.
- **Reset distribution** — how you randomize the start state each
  episode. Too narrow and the policy overfits. Too wide and it
  can't learn.
- **Success criterion** — when you call an episode done. "Reached
  goal" / "fell over" / "hit timeout."

Yard doesn't have rewards — `pd_to_goal` isn't a learned policy.
But if it were, the reward might be something like
`-dist_to_goal - 0.1*collision_penalty - 0.001*action_magnitude`.

## Domain randomization (DR) and sim-to-real

The hard problem of robot sim is the **sim-to-real gap**. The
policy that works perfectly in your simulator may walk fine in
the lab once and faceplant the second time. The gap comes from:

- Geometry mismatches (mesh vs reality)
- Mass / inertia mismatches
- Friction / damping mismatches
- Sensor noise mismatches
- Latency between sensing and acting

Two tools for closing it:

1. **Domain randomization.** Sample physical parameters from a
   distribution every episode — friction in [0.4, 1.2], mass
   perturbed by ±15 %, camera FOV jittered, lighting randomized,
   etc. The policy learns to handle the *envelope* of possible
   worlds, which usually includes the real one.
2. **System identification.** Measure your real robot's actual
   parameters (mass, motor curves, sensor latency) and stuff
   them into the sim.

In practice you do both. Yard skips both for now — we have one
deterministic friction, one fixed start (with a tiny random
jitter), and no real robot to compare against.

## Tooling beyond the physics engine

The full sim engineer's toolkit:

- **Viewer.** Live 3D view of the sim. MuJoCo has
  `mujoco.viewer.launch_passive(model, data)`. Isaac has its own.
- **Headless renderer.** Same camera image, no GUI, for batched
  data collection.
- **Replay / scrubbing.** Save trajectories and re-render later.
  Yard's `replay.mp4` is this minus the scrubbing.
- **Logging.** Structured JSONL beats print(); plotted curves beat
  JSONL. Tooling: TensorBoard, Weights & Biases, MLflow, Aim.
- **Training framework.** PPO/SAC implementations. RSL-RL,
  stable-baselines3, CleanRL, IsaacLab.
- **Cluster.** When sim takes hours, you want to run on AWS / GCP
  / a desktop with 4× RTX 4090s.
- **Versioning / data lineage.** Every result tagged with the
  exact code SHA, asset SHAs, seed list, and config. Yard's
  `config.yaml` is the start of this.

## Who's actually building robots in 2026 (and what's in their stack)

The humanoid race is on. Below are the five most visible companies,
what their robot does, and the public picture of their tech stack —
split into two columns:

- **Robot gym / training stack** — sim, RL framework, training
  compute, foundation model. The thing Yard is a tiny version of.
- **Rest of the infrastructure** — hardware design, real-world data,
  teleop, on-robot inference, deployment, fleet ops. Everything the
  brain *runs on* once it leaves the gym.

Heavy caveats up front:

- Most of this is reverse-engineered from blog posts, demos, talks,
  papers, and job listings. Specific internal libraries are rarely
  confirmed in writing.
- The pace is brutal. Some of this will be wrong in 6 months. Treat
  it as a snapshot, not gospel.
- "PyTorch + JAX (likely both)" is honest hedging — most serious
  shops use both for different stages.

---

### 1. Tesla Optimus

The most vertically-integrated humanoid effort: Tesla designs the
motors, the silicon, the simulator, the training cluster, and the
factories where the robots first deploy. Optimus piggybacks on
FSD's vision stack and Dojo training compute.

| Robot gym / training stack | Rest of the infrastructure |
|---|---|
| **Sim:** internal — believed to be a fork/derivative of MuJoCo with custom rendering. Not publicly named. | **Hardware:** in-house actuators (harmonic + planar motors), in-house gearboxes, 22-DOF hand. Vertically integrated to a degree no competitor matches. |
| **GPU sim / parallelism:** internal stack; likely MJX-style or custom batched physics on Dojo. | **Sensors:** 8 cameras, **no LiDAR** (FSD camera-only philosophy carries over). |
| **Training compute:** **Dojo** (Tesla's custom AI silicon, D1 chip) + large H100/H200 clusters. | **On-robot compute:** custom Tesla silicon, sibling of FSD HW4. Strong vertical-integration bet. |
| **Foundation model:** end-to-end neural net policy, supervised-imitation-heavy. Tesla rarely says "RL." Trained on teleop + cross-domain transfer from FSD. | **Real-time control:** classical low-level joint control under the policy; precise details closed. |
| **Data:** teleoperators in motion-capture suits; FSD-style camera data from cars; factory cameras. | **Deployment:** Tesla factories first (sort, fold, light assembly); consumer eventually. Pilot scale, not production. |
| **ML framework:** PyTorch. | **Comms:** custom; not ROS. Whole stack tightly coupled. |

The Tesla bet in one sentence: *"FSD already solved the
camera→neural-net→action loop at scale. Humanoid is the same
problem with different end-effectors."* Real proof unclear.

---

### 2. Figure AI

Brett Adcock's startup, $40B+ private valuation in 2025. First
real humanoid customer (BMW Spartanburg, 2024). Briefly used
OpenAI's models; pivoted to in-house **Helix** VLA model in early
2025.

| Robot gym / training stack | Rest of the infrastructure |
|---|---|
| **Sim:** **NVIDIA Isaac Lab + Isaac Sim** primarily; MuJoCo for prototyping and faster iteration. | **Hardware:** in-house actuators, dexterous 5-finger hands, full bipedal humanoid (Figure 02). |
| **GPU sim / parallelism:** Isaac Lab gives them ~4,096 parallel envs on a single GPU node. | **Sensors:** dual eye-level RGB cameras + body-mounted depth; no LiDAR. |
| **Training compute:** large H100/H200 GPU clusters (NVIDIA preferred-partner). | **On-robot compute:** edge GPU; Helix is quantized for inference at ~50 Hz. |
| **Foundation model:** **Helix** — Vision-Language-Action (VLA) with a **two-system architecture**: a slow deliberative system (~7 Hz) plans, a fast reactive system (~200 Hz) executes. Borrowed from Kahneman "Thinking Fast and Slow." | **Real-time control:** classical joint-level control beneath the policy stack. |
| **Data:** teleoperation from a team of operators; demonstrations from BMW operators; web-scale video pretraining. | **Deployment:** BMW Spartanburg (real production), GXO logistics pilots, consumer humanoid in 2026 roadmap. |
| **ML framework:** PyTorch + JAX. | **Fleet:** young; small numbers in field. |

Helix is the public differentiator — it's the first widely-marketed
"VLA dual-system" architecture in humanoids. They've shown demos
but no open weights or paper as of mid-2026.

---

### 3. Boston Dynamics

The oldest serious humanoid effort, now Hyundai-owned. **Atlas
(electric)** since 2024, plus Spot quadruped (in real production)
and Stretch (warehouse). Historically the most control-theory-heavy
of the bunch — the opposite cultural pole from Figure/Optimus.

| Robot gym / training stack | Rest of the infrastructure |
|---|---|
| **Sim:** internal sim built on **MuJoCo + custom rendering**; historical use of ODE. Some Drake influence. | **Hardware:** legendary mechanical design. Atlas went fully electric in 2024 (was hydraulic). Hand design more conservative than Figure. |
| **GPU sim / parallelism:** less aggressive than newer entrants; not a "millions of envs in parallel" shop. | **Sensors:** RGB-D, structured light, sensor fusion stack tuned over a decade. |
| **Training compute:** undisclosed; not headline-grabbing. | **On-robot compute:** mature perception pipelines; classical SLAM + learned components stitched together. |
| **Control:** **MPC-heavy** (their legacy advantage); learned components for specific skills (manipulation, terrain). Hybrid, not end-to-end. | **Real-time control:** their crown jewel — decades of refined whole-body control. |
| **Foundation model:** not their primary bet. They pursue layered specialists over single big policies. | **Deployment:** Spot has a real product (Orbit fleet management) in factories worldwide; Atlas is research/demo-stage. |
| **ML framework:** PyTorch + internal. | **Fleet management:** mature commercial offering (Orbit). |

BD's identity: even when they ship learned components, the
underlying whole-body control is still MPC. Viral Atlas demos are
~80% classical. They publish papers but rarely release code.

---

### 4. 1X Technologies

Norwegian; OpenAI-backed since 2023; consumer-home focus rather
than industrial. **NEO Gamma** (2025) is their main platform —
tendon-driven actuators, soft-by-design, intended for households.

| Robot gym / training stack | Rest of the infrastructure |
|---|---|
| **Sim:** Isaac Lab + MuJoCo (both shown in public talks). | **Hardware:** **tendon-driven** actuators — unique among humanoids. Inherently compliant; safer in collisions. Lower peak torque than rigid drives. |
| **GPU sim / parallelism:** Isaac Lab for parallel locomotion training. | **Sensors:** RGB cameras, conservative sensor suite, modest depth. |
| **Training compute:** large GPU clusters; OpenAI partnership shares compute and research talent. | **On-robot compute:** modest; policies sized for edge inference. |
| **Foundation model:** **learning-from-demonstration heavy**. Their public videos lean toward visual imitation; they've shown long-horizon manipulation. | **Real-time control:** classical under learned high-level. |
| **Data:** extensive teleoperation — they openly **hire teleoperators as a job category**. Home-environment-focused data. | **Deployment:** consumer home pilots; "early-access program" public 2025. Less industrial than Figure. |
| **ML framework:** PyTorch. | **Safety:** the compliant tendon drive is itself the primary safety story. |

1X's whole story is "make it safe for the home." Tendon drive is
the hardware bet that makes it possible. They've shown ironing,
laundry, kitchen tasks — long-horizon, fine-motor stuff that
showroom-floor humanoids haven't.

---

### 5. Agility Robotics

The only humanoid in **real production deployment** as of late
2025. **Digit** is a bipedal robot working in Amazon and GXO
warehouses moving totes. Pragmatic, narrow, profitable. Less
glamorous than the others; more uptime data.

| Robot gym / training stack | Rest of the infrastructure |
|---|---|
| **Sim:** **MuJoCo** primarily with their own training extensions; some Isaac Lab for parallel locomotion training. | **Hardware:** chicken-leg "digitigrade" morphology — reversed-knee birds. Extremely walking-efficient. Two arms with simple grippers. |
| **GPU sim / parallelism:** Isaac Lab for locomotion RL. | **Sensors:** stereo RGB + **LiDAR** (yes — warehouse use justifies the cost; other humanoid companies skip it). |
| **Training compute:** modest by humanoid standards; pragmatic team. | **On-robot compute:** efficient; policies are smaller because each behavior is specialized. |
| **Control:** **layered** — RL for locomotion (lower body), classical motion planning + ROS-style stack for arm + grasp (upper body). | **Real-time control:** mature; locomotion controller deployed and stable. |
| **Foundation model:** **doesn't use one.** Each behavior (walk, pick, place, navigate, charge) is a specialized component. | **Deployment:** **real**. Amazon, GXO. Paid pilots. Real-customer SLAs. |
| **ML framework:** PyTorch + JAX. | **Fleet:** uptime, charging logistics, maintenance — the boring stuff matters most. |

The contrarian of the group: no foundation model, no end-to-end
policy, no consumer dream (yet). Sells robots to warehouses today.
Their bet is that incremental warehouse capability funds the next
generation while the AI-flashy companies burn capital chasing
generality.

---

### Honorable mentions / supporting cast

You will hear these names even though they aren't (mostly) making a
humanoid. They matter as infrastructure or as research engines that
the big-5 build on top of.

**Physical Intelligence (Pi / π)** — *Foundation-model company.*
Trains a single model (**π0**, **π0.5**) that controls multiple
robot bodies (Franka, UR5, mobile manipulators). Released open
weights for π0 in 2024 — significant open-source moment. Heavy
users of teleop data + **diffusion-policy** architectures. Sometimes
called *"the OpenAI of robot foundation models."*

**NVIDIA Isaac + GR00T** — *Infrastructure provider, not a robot
company.* The platform half of the industry runs on. Stack:

- **Isaac Sim** (Omniverse-based, USD-native, photo-real rendering)
- **Isaac Lab** (RL training framework, the successor to Isaac Gym)
- **Isaac Cortex / Manipulator** (skill libraries)
- **GR00T** (a humanoid foundation model NVIDIA trains and
  open-sources for partners to fine-tune)
- **Cosmos** (a video-pretraining + sim data platform)

If you're building a humanoid in 2026 and not running on at least
one of these, you're a holdout (Tesla, Boston Dynamics) — and even
they study Isaac Lab's training tricks.

**Skild AI** — Foundation-model-for-robots play, stealthier than
Pi but well-funded. Less public stack info.

**Apptronik** — **Apollo** humanoid; NASA partnership; Mercedes-Benz
pilots. Stack publicly less detailed than competitors. Uses Isaac
Lab for training.

**Unitree** — Chinese; **G1** and **H1** humanoids at $16k–$90k —
roughly **10–20% the price of Western competitors**. Less AI
sophistication; killer hardware pricing. Their robots are widely
used as a research platform precisely because everyone can afford
one. They publish enough sim/control code that academic labs adopt
them quickly.

**Toyota Research Institute (TRI)** — Not a product company.
Publishes the **Large Behavior Model (LBM)** line and many
diffusion-policy papers. **Drake** is their open-source sim — more
formally-rigorous and control-theoretic than MuJoCo, slower, used
mostly in contact-rich manipulation research.

**Wayve / Waymo / Aurora** — Adjacent industry: autonomous driving.
Their sim/training stacks (CARLA, internal sims, massive
video-pretraining pipelines) are sibling work to humanoid stacks.
Talent flows constantly between AD and humanoid teams; many of the
training-infrastructure patterns came from AD first.

---

### Reading the map

Three patterns across the industry circa mid-2026:

1. **Sim is converging.** Almost everyone uses MuJoCo (often via
   MJX for GPU parallelism) and/or NVIDIA Isaac Sim + Isaac Lab.
   Custom sims are a shrinking minority — even Boston Dynamics
   and Tesla likely lean on MuJoCo internally for development
   even when production sim is something else.

2. **Foundation-model strategy is splitting.** One camp (Figure,
   Pi, Skild, NVIDIA GR00T) bets on a single big policy that
   handles many tasks across many robot bodies. The other camp
   (Boston Dynamics, Agility) bets on layered specialists per
   skill. Tesla and 1X straddle. Which wins is **the open
   strategic question of 2026.**

3. **Production deployment ≠ flashy demos.** Agility is in actual
   warehouses today, generating real revenue. Figure, Optimus, 1X
   are heavily funded but mostly in pilot or showroom stages.
   Whoever ships first at scale defines the field's economics for
   the next decade.

A useful mental shorthand:

| company | belief about how to win |
|---|---|
| Tesla Optimus | Vertical integration + Dojo + FSD-style data wins everything. |
| Figure | A great VLA model + manufacturing partnerships will scale fastest. |
| Boston Dynamics | Mechanical excellence + classical control + selective learning. |
| 1X | Compliant hardware + home use case + visual imitation. |
| Agility | Boring profitable deployments fund the long game. |
| Physical Intelligence | Foundation models are the platform; everyone else commoditizes. |
| NVIDIA | Sell the picks and shovels. We don't care who wins. |

Take this whole section with a grain of salt — but the patterns are
real and recent enough to be useful in conversations with people in
the field.

## Buzzwords glossary

Cheat sheet. Skim:

| word | what it means |
|------|----------------|
| **DOF (degrees of freedom)** | Number of independent joints. A 6-DOF arm has 6 joints. |
| **kinematics** | Where things are without worrying about forces. Forward = "joints → pose"; inverse = "pose → joints." |
| **dynamics** | How things move under forces. The thing MuJoCo solves. |
| **timestep / dt** | Sim physics granularity. Yard uses 5 ms. Smaller = more accurate, slower. |
| **integrator** | Algorithm that advances state given current state + derivatives. Euler (simple), RK4 (better), implicit (stable for stiff systems — MuJoCo's default). |
| **contact manifold** | Surface where two bodies are touching. Computing this is expensive. |
| **friction cone** | Bounds on tangential vs normal contact force. Coulomb friction. |
| **constraint solver** | Iteratively solves all contact and joint constraints each step. Solver iterations is a tuning knob. |
| **penetration / tunneling** | Bodies pass through each other when their relative speed × dt > thickness. Fix: smaller dt or thicker geometry. |
| **stiff system** | Equations with very fast modes. Need implicit integration. Springs, motors, contacts are all stiff. |
| **action space** | What the controller outputs. For Yard: 2 wheel velocities. For humanoids: 20+ joint torques. |
| **observation space** | What the controller reads. For Yard: chassis pose + depth summary. |
| **episode** | One run from reset to terminal condition. |
| **rollout** | A sequence of (obs, action, reward) tuples for one or more episodes. |
| **on-policy vs off-policy** | On = train from data you collect right now (PPO). Off = train from a replay buffer (SAC, DDPG). |
| **PPO** | Proximal Policy Optimization. The default RL algorithm in robotics 2024-2026. |
| **MPC** | Model-Predictive Control. Re-solve a short-horizon optimization every tick. |
| **headless** | Running without a GUI window. Required on servers and inside CI. |
| **wall clock vs sim time** | Seconds the experiment took vs seconds simulated inside the engine. Sim can be faster or slower than real time. |
| **sim2real** | The transfer problem. Often the bottleneck. |
| **TTG (time-to-goal)** | A useful metric for navigation. We log this. |
| **success rate** | The other useful metric. Fraction of seeds that succeeded. |
| **regression** | A metric that got worse than the baseline. The harness exists to catch these. |
| **gait** | A pattern of leg movements for legged robots. Trot, walk, gallop, etc. |
| **morphology** | The robot's body design. "Quadruped morphology," "humanoid morphology." |
| **end-effector / EE** | The pointy bit at the end of a manipulator. Gripper, hand, suction cup. |
| **MJCF** | MuJoCo's scene format. Yard's `assets/*.xml`. |
| **URDF** | The other scene format. More verbose, more widespread. |
| **USD** | NVIDIA's format. Heavy, powerful, becoming standard in industrial sim. |
| **ROS / ROS 2** | Robot Operating System. Inter-process messaging + tools. Industry-standard for "real" robots. |

## Common gotchas

Things that will absolutely happen to you the first month:

1. **The robot explodes / flies off / spins violently.** Usually
   mass / inertia is wrong. Or you set a joint position that
   penetrates an obstacle and the contact solver responds with
   infinite force.
2. **The robot falls through the floor.** Forgot to make the
   floor collidable, or the contact margin is wrong.
3. **Wheels spin but the bot doesn't move.** Friction is too low,
   or you set the motor's kv wrong, or you commanded position
   instead of velocity.
4. **Depth camera returns garbage / zeros.** Near clip plane is
   wrong, or you didn't call `enable_depth_rendering()`, or you
   forgot to update the scene before each render.
5. **The episode succeeds in the viewer but fails headless.**
   Different random initial state because you forgot to seed.
   Always seed everything.
6. **Sim runs slower than real time.** Usually too many contacts,
   or too small a timestep, or you're rendering every step (don't).
7. **Policy works at seed 42 but not seed 43.** Welcome to robotics.
   The fix is always: more seeds, more domain randomization, or
   better reward shaping.
8. **The replay video looks different from the live run.** You
   probably re-stepped physics inside the render call. Don't.

## Best practices

- **Determinism first.** Seed everything (numpy, MuJoCo, your
  controller, your reward). Log the seed in `config.yaml`. A run
  that can't be reproduced isn't a result, it's a vibe.
- **Save artifacts.** Every run gets its own directory with
  events, trajectory, video, metrics. Don't print to stdout and
  call it done.
- **Multi-seed everything.** Never trust a single-seed success
  story. 10 seeds minimum for evals, 100 for paper results.
- **Treat sim as software.** Tests, CI, regression suites. If you
  can't `yard regress` and know your changes are safe, you're
  flying blind.
- **Start with the simplest scenario that has the failure mode.**
  Don't reproduce the bug in your fancy 6-robot warehouse if the
  same bug appears in a single-robot empty room.
- **Visualize before you metric.** Watch the replay. The number
  in `metrics.json` says "failed at t=4.2s" — the video shows you
  the bot wedged itself into a corner backwards. That story is
  the bug.
- **Sensor noise from day one.** Don't train a policy on zero-
  noise sensors. You'll have to retrain later, on noisy ones, and
  the policy will be worse.

## Where to go from here

A short reading list if you want to actually get good:

1. **Run Yard end-to-end with one bug.** `YARD_BUG_DEPTH_CLIP=1 uv
   run yard regress --suite default`. Read the failing
   `events.jsonl` for one seed. Open `replay.mp4`. Stare at it
   until the bug is obvious.
2. **Read MuJoCo's tutorial.** It's short and excellent.
   [`mujoco.readthedocs.io`](https://mujoco.readthedocs.io)
3. **Browse MuJoCo Menagerie.** A zoo of production-quality robot
   models — Franka, Anymal, Spot, Go2, UR. Pick one and load it
   into Yard. Replace the diff-drive bot.
4. **Try training a policy.** RSL-RL, stable-baselines3, or
   CleanRL all have ~50-line PPO scripts that train a humanoid in
   an hour on a laptop GPU.
5. **Read one paper.** "OpenAI Cube" (in-hand cube manipulation
   trained in sim with domain randomization, deployed on a real
   hand) is the canonical sim-to-real story. Skim it.
6. **Read another paper.** "ANYmal Wild Locomotion" (legged robot
   walking on tundra, jungle, snow). End-to-end RL trained
   entirely in MuJoCo, transferred to a real quadruped, no
   fine-tuning. The state of the art as of ~2024.
7. **Pick a single open challenge and solve it.** "Make the bot
   in Yard succeed at warehouse_b under
   `YARD_BUG_HEADING_DRIFT=1`." Or: "make a 3-robot version of
   warehouse_a where they don't collide with each other."

You now know roughly what 80 % of the people in the field are
actually doing day-to-day. The rest is taste, scar tissue, and
which sim engine you yell about on the internet.
