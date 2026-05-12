# Yard, explained for engineers who've never touched robotics

This doc explains what Yard is and the pieces we use to build it, aimed at engineers who can write code but have never worked on robotics, simulation, or physics-related software. If you've shipped web apps, backend services, or even just CLI tools, you have enough background to follow this.

---

## What is Yard, in 30 seconds

Yard is a **tiny robot world that lives entirely inside Python**. There's no actual robot. There's no actual warehouse. There's just code that pretends both exist accurately enough that we can run experiments on them.

A "robot" is a piece of code (a controller / policy) that takes inputs from fake sensors and outputs wheel commands. A "world" is a config file describing geometry, gravity, and physical properties. A "run" is a script that ticks the physics forward in time and records what happens. The output is data: a video, some metrics, a trajectory file.

If you've used `pytest` to test a backend service, you already get most of the mental model. Yard is the system under test; a run is one test invocation; the metrics file is the test result; the video is a screenshot of what happened.

The difference: instead of asserting `result == expected`, you assert "the robot reached the goal without crashing in 8 out of 10 attempts."

---

## Why simulators exist at all

Real robots are:
- **Expensive** ($10k-$200k for a useful one)
- **Slow** (one trial = real minutes of real time)
- **Dangerous to crash** (broken sensors cost real money)
- **Hard to scale** (you can't run 1,000 robots in parallel in your office)

Simulators are:
- **Free** after you've written them
- **Fast** (a "minute" of sim time can run in a few seconds of wall time)
- **Crashable** (so what)
- **Parallelizable** (run 1,000 episodes overnight on a GPU cluster)

So almost every robotics company uses simulation heavily — to test ideas, train ML policies, validate fixes before deploying to real hardware. Real robot tests come at the *end*, not the start.

This is similar to how backend devs spend 90% of their time on a dev machine and only 10% touching production. Robotics sim is the dev machine.

---

## What a single Yard run looks like

Here's the warehouse scene Yard simulates (top-down view):

```
+----------------------------+
|                            |
|   [box]                    |
|                       [G]  |
|                            |
|   [box]      [box]         |
|                            |
|     [R]------>             |
|                            |
+----------------------------+

  R = robot (start position)
  G = goal
  [box] = static obstacles
  --> = robot's forward direction
```

A run does this:

1. **Load the scene** — read a config file that describes the room, the obstacles, the robot's starting pose, the goal location.
2. **Reset to start** — robot at position R, wheels not moving, simulation clock at 0.
3. **Tick forward** — every 20 milliseconds of sim time:
   - Render what the robot "sees" through a fake forward-facing depth camera (a grid of distances, like a heatmap)
   - Pass that sensor reading to the **policy** — a Python function that decides "turn left a bit, drive forward"
   - Apply those commands to the simulated wheels
   - Let the physics engine compute the new robot position, check for collisions
4. **Stop when** the robot reaches the goal, hits an obstacle, or 30 seconds of sim time pass.
5. **Write outputs** — a folder with: a JSONL log of every tick, the depth frames the robot saw, a trajectory file (x/y over time), a metrics file (success/fail, time-to-goal, collisions), and an mp4 of the whole run from a bird's-eye view.

A `yard eval` runs the same thing 10 times with 10 different random seeds. The aggregate result is one number: success rate (how often the robot made it to the goal). If success rate is above 0.8, the policy passes.

---

## The components

Here's everything Yard is made of, each with a familiar analogy.

### MuJoCo — the physics engine

**What it is.** A library (now Apache 2 licensed, free for any use) that computes "what physically happens" when you push, pull, or move objects in a 3D scene. Given the state of the world (positions, velocities, forces), it computes the state one tick later.

**Familiar analogy.** Think of it as a game engine like Unity, except focused on *correct physics* rather than fun graphics. It's used in research labs all over the world. Pure C library with Python bindings.

**What it does in Yard.** Holds the simulated world. Every time we say "move the wheels forward at 0.5 rad/sec for 20ms," MuJoCo figures out where the robot ends up, whether it hits a wall, what forces the wheels exert. Without it, we'd be writing collision detection and friction equations by hand. With it, those are one function call.

### MJCF — the scene description language

**What it is.** An XML format that MuJoCo reads. You write a file that says "there's a floor, here's a robot with two wheels and a chassis, here are some boxes scattered around as obstacles, here's a camera on the robot's front."

**Familiar analogy.** It's the `package.json` or `docker-compose.yml` of a robotics scene. A config file that declares what exists. You author it by hand or generate it from code.

**What it does in Yard.** Defines the warehouse, the robot's body, the obstacles, the goal. We'll have maybe 3-5 different MJCF files — one for each scenario we test against.

### URDF — alternative robot description

**What it is.** A different XML format (older, more widely used outside MuJoCo) for describing a robot's joints and parts. It's the lingua franca of the robotics world.

**Familiar analogy.** Think of MJCF and URDF like JSON vs YAML — they're competing standards for the same thing. We'll mostly use MJCF (it's simpler and MuJoCo-native), but URDF is good to know about because every real robot ships with a URDF file.

### The depth camera (built into MuJoCo)

**What it is.** A virtual camera mounted on the robot that returns, every tick, a 2D grid of distances: "the wall is 2.3 meters away in this direction." Not RGB pixels — *distances*.

**Familiar analogy.** Imagine a grid of laser pointers, each measuring how far away the nearest surface is in its direction. The result is a 64×48 numpy array of floats. You can render it as a heatmap and it looks vaguely like a grainy gray image where things closer are brighter.

**What it does in Yard.** It's the robot's only sense of its surroundings. The policy decides what to do based purely on this depth array. (Real robots use multiple sensors — RGB cameras, lidar, etc. We use depth alone for simplicity.)

### The policy (just Python code)

**What it is.** A Python function. Takes the depth camera array as input. Returns two numbers: left wheel speed and right wheel speed.

```python
def policy(depth_image: np.ndarray) -> tuple[float, float]:
    # ... decide what to do
    return left_wheel_velocity, right_wheel_velocity
```

**Familiar analogy.** It's a request handler. Input: HTTP request (well, depth image). Output: HTTP response (well, two numbers).

**What it does in Yard.** It's the "brain" of the robot. In Yard v0.1, our first policy is hand-written (e.g., "find the open direction in the depth image and drive that way"). Later, we might replace it with a trained neural network (a small PyTorch model). The interface stays the same — depth in, wheel commands out.

This is the most important point of the whole project: **the policy is just a function.** Robotics-the-software-discipline is mostly about making functions like this one work correctly across many situations.

### Python + NumPy + standard scientific libraries

**What they are.** Python is the host language. NumPy handles array math (the depth image is a NumPy array; trajectories are NumPy arrays). PIL/imageio handle saving images. ffmpeg (via Python) makes mp4 videos.

**Familiar analogy.** This is your normal Python stack. Nothing exotic.

**What they do in Yard.** Hold sim state, run loops, save data, generate replay videos. 95% of the code we write is plain Python.

### PyTorch + MPS / CUDA (optional, later)

**What it is.** PyTorch is the ML framework. MPS is Apple Silicon's GPU compute backend. CUDA is NVIDIA's. Both let PyTorch use a GPU instead of a CPU for tensor math.

**Familiar analogy.** PyTorch is the React of ML libraries — most code in the field is written against it.

**What they do in Yard.** Nothing in v0.1. Later, if we want our policy to be a learned neural network (instead of hand-written rules), we'd train it with PyTorch. On a Mac, PyTorch uses MPS to access the M-series GPU. On a remote Linux box, it uses CUDA. We don't need this until we want a smart policy.

### Output formats — JSONL, npz, JSON, mp4

**What they are.** Standard file formats. JSONL is JSON-per-line (good for streaming logs). npz is NumPy's compressed array format. JSON for metric summaries. mp4 for video.

**Familiar analogy.** Same files you'd use for any data pipeline.

**What they do in Yard.** Each run produces a folder with:
- `events.jsonl` — one JSON object per tick: timestamp, robot pose, sensor data summary, action taken
- `depth_frames/*.png` — saved depth images at fixed intervals
- `trajectory.npz` — compressed array of full positions over time
- `metrics.json` — summary: success/fail, time-to-goal, collision count
- `replay.mp4` — a video of the run from above

These files are what Range (the harness) reads to show evidence in its UI.

---

## What a day building Yard actually looks like

Let's pretend you're three weeks in. The basic sim works; the warehouse scene loads; a simple policy gets ~70% success rate. Today you want to improve it.

**Morning.**
- Open Yard's policy file. Add a small change: prefer directions that look "more open" by averaging the depth values in a wider region.
- Run `yard run --scenario warehouse_a --seed 42` from the terminal. Watch it stream metrics. Robot reaches the goal in 12 seconds. ✓
- Run on seed 43. Robot drives in a circle for 30 seconds and times out. ✗
- Open the mp4 of the failing run. Watch the robot oscillate.

**Midday.**
- Suspect the averaging window is too wide and the robot loses fine obstacle detail.
- Add a config knob for the averaging window size.
- Run `yard eval --scenario warehouse_a --seeds 42..51` — 10 seeds in parallel.
- Get a `pass.json` back: `success_rate: 0.6`. Worse than before.
- Bisect: try a few window sizes. Find the sweet spot at window=3 (you started at 5). `success_rate: 0.9`.

**Afternoon.**
- Add a regression test for "warehouse_a, multi-seed, window=3" so this doesn't drift.
- Write up the change as a PR. Include the before/after success rates, an mp4 from a tricky seed showing the fix in action.
- Merge.

That's the loop. Most of the day is: *change → run → look at metrics → look at video → debug → repeat*. Range exists to make this loop fast and to make the evidence (metrics, video, before/after) easy to package up for review.

---

## How robotics sim is *different* from normal software

Three differences worth flagging because they trip up first-timers.

**1. The system is continuous, not discrete.**

Most software you've written has discrete states: this user is logged in or logged out. This API request succeeded or failed. Robotics sim is continuous: the robot's position is a vector of real numbers that change every 20ms. Small input errors can compound into very different outputs after many steps. "Reproducibility" requires controlling the random seed, the timestep, the exact library versions — change any of these and the result drifts.

**Implication for debugging:** "It works on my machine" is even more treacherous here. The fix isn't to look at logs; it's to capture enough state (seed, config, code SHA, library versions) that any run can be exactly reproduced anywhere.

**2. There is no single source of truth.**

In normal software, you assert `result == expected`. In sim, you assert "this run *probably* worked, based on a metric, and *also* looks right when I watch the video." Both can disagree:
- The metric says "success rate 0.92" but in the video the robot is shaking weirdly the whole time. Something's wrong, even though tests pass.
- The metric says "failure" but in the video the robot reaches the goal — there's a bug in the metric, not the policy.

**Implication:** evidence isn't just numbers. Video, frames, trajectories all matter. This is exactly why Range emphasizes visual evidence as much as metric thresholds.

**3. The "right" answer is often statistical.**

A regular bug is "this returns the wrong value." A sim bug is often "this returns the right value 60% of the time and the wrong value 40% of the time, and that's a 5-percentage-point regression from last week." Single-shot debugging doesn't work. You need to run many seeds and look at the distribution.

**Implication:** every meaningful comparison is N seeds vs N seeds, not 1 vs 1. The eval loop matters more than the unit test loop.

---

## Glossary

Quick reference for terms used above and elsewhere in the Range docs.

| Term | What it means |
|---|---|
| **Simulator** | A program that pretends a physical world exists by computing physics in software |
| **Policy** | The function that decides what the robot does given its sensor input |
| **Episode / run** | One full attempt at a task, from reset to success/failure |
| **Eval** | Running many episodes (usually with different random seeds) and aggregating the results |
| **Seed** | The random-number-generator seed; controls reproducibility |
| **Scenario** | A specific configuration of scene + start state + goal |
| **Trajectory** | The full path the robot took over time (positions, velocities) |
| **MuJoCo** | The physics engine we use |
| **MJCF / URDF** | XML formats for describing robots and scenes |
| **Tick / timestep** | One step of the simulation (e.g., 20ms of sim time) |
| **Depth camera** | A sensor that returns distances rather than colors |
| **Sim-to-real gap** | The difference between how a policy behaves in sim vs on real hardware. This is one of the central problems in the field. We don't tackle it in Yard v0.1. |
| **Reinforcement learning (RL)** | A way to *learn* a policy by trial and error in simulation. Optional, later. |
| **PyTorch** | The ML library most people use to train neural network policies |
| **GPU / CUDA / MPS** | Hardware acceleration. CUDA for NVIDIA GPUs, MPS for Apple Silicon. |
| **NumPy** | Python's array math library. All the sensor data and trajectories are NumPy arrays. |
| **Headless** | Running the simulator without a graphical window. We always run headless and replay later from saved data. |

---

## TL;DR

Yard is a small Python project that pretends a robot exists in a warehouse. The physics is handled by MuJoCo (a free library). The robot has one fake depth-camera sensor. A Python function (the "policy") decides what the robot does. Every run produces logs, metrics, and a video — these are the evidence that Range (our development harness) reads.

You can build this with normal software-engineering skills. You don't need a PhD, you don't need to know physics math, you don't need a GPU, and you can run it on a Mac. The hard parts are the same hard parts as any complex system: reproducibility, edge cases, evidence-backed debugging.

The reason we're building it is to feel — viscerally and weekly — what kinds of pains robotics developers actually have. Range exists to solve those pains. Yard exists to keep Range honest.
