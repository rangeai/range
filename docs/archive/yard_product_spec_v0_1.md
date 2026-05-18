# Yard — Product Specification v0.1

**Document type:** MVP product spec
**Working name:** Yard (rename later if desired)
**Status:** Draft v0.1 — deliberately minimal robotics sim for dogfooding Range
**Date:** 2026-05-12
**Co-built with:** Range MVP (see `range_mvp_spec_v0_1.md`)

---

## 0. The point of Yard

Yard is **not** trying to be a useful robotics simulator. It exists for three reasons:

1. **Generate the hardest, realest Range workflows.** Every Yard pain becomes a Range feature requirement, validated by frustration rather than guessed at.
2. **Teach domain depth.** Building a real (if tiny) sim from scratch is how you learn the textures of robotics development that no paper or interview will surface.
3. **Be the first dogfood project for Range.** Yard is built using Range, end-to-end.

**Failure mode to avoid:** Yard becomes the project, Range becomes the side project. The sim is a means; Range is the goal.

**Forcing function:** Yard's codebase must stay under **2,000 lines** through v0.1. If it grows beyond that, the spec has failed.

---

## 1. Scope: deliberately tiny

| | Choice | Reason |
|---|---|---|
| Robot | One — differential-drive wheeled bot, two wheels and a chassis | Simplest viable embodiment |
| Environment | One — a 6m × 6m warehouse-style floor with 4-6 static obstacles | Enough complexity for navigation to matter |
| Sensor | One — forward-facing depth camera, 64×48 per tick | Depth output is the strongest visual evidence demo |
| Task | One — navigate from start to goal without collision | Universally legible failure modes |
| Eval | Multi-seed success rate over 10 seeds | Exercises Range's statistical-verification model |

Nothing else. No multiple robots, no procedural scenes, no manipulation, no domain randomization beyond seeds, no photoreal rendering, no other sensor modalities.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Physics | **MuJoCo** (Apache 2) | Native Mac, fast on CPU, mature Python API, no licensing land mines |
| Scene description | **MJCF** (start), USD later if useful | MJCF is simpler and faster to author than USD for this scope |
| Robot description | MJCF + URDF | Standard formats |
| Sensor rendering | MuJoCo's built-in depth renderer | No extra dependency |
| Control | Pure Python policy; optional PyTorch RL in phase 2+ | Keep the ML stack minimal until it earns its place |
| Training (optional) | PyTorch + MPS on Mac, CUDA on remote | Range will dispatch to remote for training-heavy runs |
| Eval driver | Plain Python script that runs N seeds and writes a metrics file | Boring is correct |
| Data formats | JSONL for events, mp4 for video, npz for trajectory, JSON for metrics | Machine-parseable, Range-ingestible |

**Notably skipped in v0.1:** Warp. MuJoCo is enough and runs locally on a Mac. Add Warp in v0.2 only if differentiable physics or massive parallel sim becomes worth the friction.

---

## 3. Deliverables

The Yard repo at v0.1 produces these CLI surfaces:

```bash
yard run --scenario warehouse_a --seed 42
yard eval --scenario warehouse_a --seeds 42,43,44,45,46,47,48,49,50,51
yard regress --suite default
```

Each `yard run` invocation writes a run directory:

```
runs/warehouse_a-seed42-<timestamp>/
  events.jsonl              # per-tick structured events (pose, contact, sensor, reward)
  depth_frames/*.png        # depth frames at fixed intervals
  trajectory.npz            # full trajectory data
  metrics.json              # success flag, time-to-goal, collision count
  replay.mp4                # top-down rendered replay
  config.yaml               # exact config used (seed, scenario, code SHA)
```

Each `yard eval` aggregates across seeds and writes:

```
evals/warehouse_a-<timestamp>/
  per_seed/*.json           # per-seed metrics
  summary.json              # success_rate, mean_ttg, total collisions
  pass.json                 # boolean: was the pass threshold met (≥0.8 success)
```

**Yard does NOT have:**
- A UI of its own (Range provides UI)
- A scene editor (Hand-author MJCF or use one provided)
- A live viewer (replay video is enough)
- Custom rendering beyond MuJoCo's built-in
- An orchestration layer (Range orchestrates)
- Cloud integration (Range dispatches to runners)

---

## 4. Phases (8-10 weeks part-time, paired with Range)

### Phase 1 — Bring-up (2 weeks)
- MuJoCo installed locally on Mac
- One robot in one MJCF scene, depth camera renders
- A single `yard run` works headless and produces the run directory
- A canonical "good" policy (PD controller heading toward goal) gets ~90% success on the chosen scenario

**Pairs with Range MVP Phase 1.** Range's local runner wraps `yard run`, captures the evidence files, shows logs + frames in the UI.

**Exit criteria:** opening Range, typing "run yard warehouse_a seed 42," and seeing logs + a depth frame stream into the evidence panel.

### Phase 2 — First real workflow (3-4 weeks)
- Multi-seed `yard eval` works
- The regression suite of 3 canonical scenarios is in place
- One deliberate bug is introduced (e.g., a sign error in pose update that drifts after long episodes)

**Pairs with Range MVP Phase 2.** Range is used to: reproduce the bug on baseline, drive Codex investigation read-only, generate the fix in a new attempt, run multi-seed verification, draft an evidence-backed PR.

**Exit criteria:** the Priya scenario is lived end-to-end against Yard.

### Phase 3 — Cross-layer pain (3-4 weeks)
- Yard is split into two repos: `yard-engine` (the sim core, MJCF wrapper, sensor sim) and `yard-apps` (scenarios, policies, evals)
- A change in `yard-engine` is made that subtly breaks `yard-apps` (e.g., depth-renderer config bump that changes noise characteristics)

**Pairs with Range MVP Phase 3.** Range is used to: catch the regression in `yard-apps`, do cross-layer debugging that traces back to `yard-engine`, file evidence-backed handoff between the two "teams."

**Exit criteria:** the Anika scenario is lived end-to-end across Yard's own layers.

---

## 5. Success criteria

By end of Phase 3:

1. Range can execute the full Priya and Anika scenarios on real (Yard) code, not mocked content
2. You can name at least 5 specific Range feature improvements that came directly from feeling Yard's pains
3. Yard's codebase is still under 2,000 lines

If Yard exceeds 2,000 lines, the spec has failed — too much energy went into the sim instead of into Range.

---

## 6. Out of scope (forever, in v0.1)

- Photoreal rendering (RTX or otherwise)
- Real-world hardware integration
- Multi-robot scenarios
- Manipulation tasks
- Domain randomization beyond seeds
- Custom physics engines
- Distributed training
- A pretty UI of any kind
- Pretty visualization beyond basic replay

If you find yourself wanting any of these, that's a sign you're treating Yard as a product. It's not.

---

## 7. Why this scope is right

This scope produces, in 8-10 weeks, every workflow Range claims to solve:

- *"My depth output looks wrong on seed 7 but the test passes"* — visual evidence beats numeric verification
- *"I refactored the sim loop and now eval takes 2x as long"* — performance regression catch
- *"Sensor returns NaN at certain robot poses"* — reproduction + structured evidence
- *"This works locally but fails on the remote runner"* — cross-environment debugging
- *"I changed the noise model and three downstream scenarios broke in ways I don't understand"* — cross-layer investigation
- *"My policy learns fine on seed 42 but diverges on seed 43"* — statistical-verification stress

Each of these is a Range scenario waiting to be lived. Yard generates them by being deliberately minimal but real.

---

## 8. What this is not

Yard is **not** the unicorn. The unicorn is Range (and what Range becomes — see `range_product_spec_v0_4_codex_sim_streaming.md` and the strategy discussion). Yard is the dogfood substrate that gets Range's MVP to credible.

If, much later, Yard turns out to be the seed of something larger (a scenarios marketplace, a verification battery, an open-source robotics sim), that's a bonus we earn. We don't plan for it now.
