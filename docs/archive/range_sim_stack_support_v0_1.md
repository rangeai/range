# Range — Sim stack support priorities v0.1

**Document type:** Stack support priorities
**Status:** Decision doc — supersedes ad-hoc choices
**Date:** 2026-05-12
**Anchored on:** `range_positioning_v0_1.md` (NVIDIA-independent, public-repo-only integration)

---

## Top 2 stacks Range will officially support

### 1. MuJoCo (Apache 2.0, Google DeepMind)

**Why first:**
- **Highest adoption** in robot sim (12.7K GitHub stars, leading among open engines).
- **Vendor-neutral** under Apache 2.0.
- **Where learning-based robotics actually lives** — RL research, manipulation, locomotion. Our agentic wedge (eval iteration, reward shaping) lands hardest here.
- **Healthy trajectory:** MuJoCo XLA (GPU via JAX), MuJoCo Warp (GPU via public NVIDIA Warp library), MuJoCo Playground (won RSS 2025 Outstanding Demo). Community is actively investing.
- **mjlab signal:** a project at 2.2K stars rebuilding Isaac Lab's API on top of MuJoCo Warp — the community is moving *toward* MuJoCo for portability, *away* from Isaac Lab's Kit dependency.
- **We get it for free:** Yard (our dogfood sim) is already MuJoCo-based.

**Audience:** RL researchers, ML engineers at robotics startups, embodied-AI teams, academic robotics labs.

### 2. ROS 2 + Gazebo (Apache 2.0, Open Robotics / OSRF)

**Why second:**
- **The de facto stack for production robotics.** Mobile robots, AV, drones, industrial automation, anything that ships to real hardware.
- **Vendor-neutral** under Apache 2.0.
- **Covers the half of robotics MuJoCo doesn't:** sensor fusion, navigation stacks, multi-robot coordination, ROS message passing.
- **Bridge to future expansion:** the rosbag / ROS message model is the natural entry point for ingesting real-robot telemetry later. Supporting ROS 2 + Gazebo positions us to grow outward from sim into telemetry/deployment without rework.
- **Massive installed base** that the MuJoCo-only positioning misses.

**Audience:** Production robotics engineers, AV perception/planning teams, drone/industrial automation engineers, ROS-native users.

---

## Coverage map

| Workflow | MuJoCo | ROS 2 + Gazebo |
|---|---|---|
| RL training (locomotion, manipulation) | ✅ Native | ⚠️ Possible but awkward |
| Manipulation research | ✅ Native | ⚠️ Less ideal |
| Mobile / navigation stacks | ⚠️ Limited | ✅ Native |
| Sensor-rich AV perception | ⚠️ Limited | ✅ Native |
| Sim-to-real prep | ✅ Via MuJoCo Playground | ✅ Via ROS bridges |
| Multi-robot / fleet | ⚠️ Limited | ✅ Native |
| Direct production deployment path | ❌ Pure sim | ✅ Real-hardware bridges |

The two are nearly orthogonal — minimal overlap, together they cover both halves of robot-sim work.

---

## What "officially supporting" a stack means

### Shipped artifacts per stack

- **Sample `range.yaml` profile** — a known-good template a user copies into their project. Declares setup, reproduce, evaluate, artifact globs, and metric definitions.
- **Quick-start documentation** — 15-minute target from clone to first session.
- **Evidence parser** — understands the stack's logged data format (MuJoCo's trajectory dumps, rosbag `.mcap` files).
- **One canonical demo scenario** —
  - MuJoCo: Yard (already exists)
  - ROS 2 + Gazebo: a turtlebot navigation scene (to be built)
- **Profile-aware commands** — `reproduce`, `evaluate`, `verify` mapped to each stack's idiom.

### What's not in MVP, but on the roadmap

- Native rosbag viewer in the evidence panel (ROS 2 audience priority)
- MuJoCo Playground task template library
- Stack-specific evidence visualizations (trajectory overlays, sensor data review)

### What we will not do

- Take a runtime dependency on either stack inside Range itself. Users bring the stack; Range orchestrates.
- Position one stack over the other in user-facing copy. Both are first-class.

---

## Honorable mention for future support

**Drake** (BSD, ~3.9K stars, Toyota Research) — narrower scope than the top 2 (manipulation, MPC, model-based control, verification) but the most thoughtfully engineered codebase in robotics. Strong cohort of high-quality users (Toyota Research, academic MPC groups, manipulation researchers). Add as third priority once we have headroom and an actual user requesting it.

---

## Stacks Range will not anchor on (per positioning policy)

These are *supported user stacks* (users can declare them in their `range.yaml` profile and Range orchestrates them) but never Range core integrations:

- **Isaac Lab** (BSD-3, ~7.1K stars) — open source but requires Omniverse Kit runtime. The migration of community work toward MuJoCo Warp / mjlab is a signal that Isaac Lab's Kit-dependence is a drag, not an asset.
- **Isaac Sim 5.0** (open-sourced 2025, requires Omniverse Kit) — same reasoning, larger runtime footprint.
- **Anything from Omniverse Kit's monolithic application surface** — per the Kit disaggregation update, NVIDIA itself is moving away from this.
- **Brax, Genesis, Habitat** — strong technically, smaller adoption. Reconsider as adoption grows.

---

## Decision rule for future stack support

A stack becomes officially supported when **two** of the following are true:

1. ≥5K GitHub stars or equivalent adoption signal
2. Open source under a permissive license (Apache 2, BSD, MIT, Zlib)
3. Vendor-neutral runtime (no required hardware/vendor lock-in)
4. ≥3 Range users actively requesting it

Top 2 today satisfy all 4. Drake satisfies 1, 2, 3 (waiting on 4). Isaac Lab fails 3.

---

## Mac dev viability (2026)

Both stacks run natively on macOS Apple Silicon in 2026, which means **Range development and demo work can proceed entirely on a Mac** before any remote-runner infrastructure exists.

| Stack | Mac status | Install path |
|---|---|---|
| MuJoCo | First-class native, Apple Silicon | `pip install mujoco`; MJX uses Metal. Yard's existing path. |
| ROS 2 + Gazebo | Community-native (IOES-Lab installers); not Tier 1 official | ~30 min one-time install via `github.com/IOES-Lab/ROS2_Jazzy_MacOS_Native_AppleSilicon`. Avoids Docker / Rosetta overhead. ROS 2 Kilted has demoed natively on Apple Silicon with Gazebo Ionic + MoveIt 2 + Navigation 2. |

**Implication for the MVP phasing:** the Gazebo demo is no longer gated on remote-runner work. We can build and verify the turtlebot navigation profile on the Mac during Phase 2, alongside the MuJoCo profile. Phase 3's SSH-remote runner becomes a "scales up" feature for heavy training workloads, not a prerequisite for shipping Gazebo support.

---

## Sources

- Black Coffee Robotics — Robot Simulation Software: A 2026 Perspective (https://www.blackcoffeerobotics.com/blog/which-robot-simulation-software-to-use)
- best-of-robot-simulators weekly-updated list (https://github.com/knmcguire/best-of-robot-simulators)
- mjlab — Isaac Lab API powered by MuJoCo Warp (https://github.com/mujocolab/mjlab)
- Isaac Lab paper, arXiv 2511.04831 (https://arxiv.org/html/2511.04831v1)
- State of Robotics 2026 Report — Silicon Valley Robotics Center (https://www.roboticscenter.ai/state-of-robotics-2026)
