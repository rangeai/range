# Range — Positioning v0.1

**Document type:** Positioning + dependency policy
**Status:** Authoritative for product decisions until superseded
**Date:** 2026-05-12

---

## One-line

**Range is the agentic IDE for robot simulation.**

## Audience

Robotics ML engineers, simulation engineers at robotics companies, embodied-AI researchers, and physical-AI labs. Their daily work is reward functions, multi-seed evals, policy iteration, scenario design, sim-to-real prep. Their day is fragmented across editor, sim, terminal, W&B, Slack, and a spreadsheet — Range collapses that loop.

## Wedge

The agentic loop is uniquely powerful in robot sim because the workflows have well-defined success metrics (task completion, multi-seed pass rate, reward distributions). An agent that can edit a reward function, dispatch a multi-seed eval across runners, surface what regressed, and draft a PR with structured evidence — that's a step-change in how this work feels. No existing tool does this.

## What Range is not

- Not a general-purpose IDE — we don't compete with Cursor / VSCode on editor features
- Not a data viz tool — Foxglove owns that surface; we complement it
- Not a simulator — we orchestrate simulators (MuJoCo, Drake, Isaac Lab, custom)
- Not a fleet management or hardware-deployment tool (yet — future expansion)
- Not a closed ecosystem — we're MIT and stack-agnostic

---

## Vendor-independence policy

Range is deliberately **NVIDIA-independent**. We can integrate with NVIDIA technology *only* against publicly available repositories and packages. The default product works without any NVIDIA stack present.

### Allowed dependencies

| Layer | Allowed |
|---|---|
| Runtime | Bun, Node, Python (user-side), TypeScript, React, Hono |
| Sim engines | MuJoCo (Apache 2), Drake (BSD), PyBullet (Zlib), Gazebo / ROS 2 (Apache 2), Brax, Genesis, custom |
| Scene formats | USD (Pixar/AOUSD, open), MJCF, URDF |
| ML / training | PyTorch (any backend), JAX, scikit-learn |
| Agent | OpenAI Codex (the user's account) |
| Public NVIDIA tech | Warp (`github.com/nvidia/warp`), ovrtx (`github.com/nvidia-omniverse/ovrtx`) — only at the user's option, never as a core requirement |

### Forbidden dependencies

| Layer | Forbidden |
|---|---|
| Hardware | Any requirement for NVIDIA GPUs as a core dependency |
| Runtime | Omniverse Kit as a core runtime |
| Software | Isaac Sim or Isaac Lab as a Range dependency (they remain *supported* user stacks, never required) |
| Surfaces | Any feature that requires NDA, internal NVIDIA SDK, or non-public NVIDIA API |
| Licensing | Any feature that gates on Omniverse commercial licensing |

### Examples in practice

- **OK:** A Range user declares Isaac Lab as a profile dependency. Range orchestrates their training runs. Isaac Lab is open source. Range never imports it.
- **OK:** A future Range plugin uses public Warp APIs to render scene previews. User installs Warp themselves.
- **NOT OK:** Range ships a Kit extension that requires Omniverse Kit at runtime. Crosses the line.
- **NOT OK:** Range integrates with NVIDIA-internal infrastructure (private package registries, internal eval datasets). Crosses the line.

### Why this matters

1. **TAM.** Robot sim users are heterogeneous. Many never touch NVIDIA's stack; binding Range to NVIDIA halves the market.
2. **Strategic independence.** If NVIDIA changes direction, raises prices, or restructures Omniverse, Range continues to work.
3. **Partnership optionality.** We can later partner with NVIDIA (extension marketplace, joint demos, technical collaboration) from a position of independence — not as a captive satellite.
4. **Investor optics.** Single-vendor dependence is a known startup failure mode. Multi-vendor positioning is a value driver.
5. **Founder context.** The Range founder works at NVIDIA. Range as an independent product is a separate venture, not an NVIDIA satellite. This positioning makes the separation explicit and clean.

---

## Why we chose "IDE for robot sim" over alternatives

| Alternative | Why we rejected it |
|---|---|
| "Generic agentic harness for simulation-heavy software" | Too broad. Loses focus. Doesn't help us prioritize features or messaging. |
| "Agentic IDE for Isaac Sim users" | Too narrow + too NVIDIA-bound. Halves the market. Violates the independence policy. |
| "Agentic IDE for robotics" | Too broad. Includes hardware, deployment, fleet — not shippable as MVP. Vision-level, not product-level. |
| "Terminal-as-canvas agent UI" | Different product, separate thesis. Worth pursuing as its own thing, not as Range. |

"IDE for robot sim" is the sharpest framing that's both:
- **Big enough to be ambitious** — robotics is one of the major waves of the decade
- **Narrow enough to be shippable** — a focused audience with shared vocabulary and workflows

---

## What the future broadening could be

Long-term, the natural expansion is outward from sim:

1. **MVP today:** Sim — sessions, attempts, multi-seed eval, evidence, PR
2. **Year 1-2:** Sim + telemetry — ingest rosbags and real-robot logs into the same evidence model
3. **Year 2-3:** Sim + telemetry + deployment — push policies/firmware to real robots, monitor rollout
4. **Year 3+:** The unified agentic dev environment for robotics

Each expansion is a separate decision earned by traction, not assumed.

---

## Tagline candidates

- "The agentic IDE for robot simulation."
- "An agentic proving ground for robot policies."
- "Evidence-backed robot sim development, with an agent in the loop."

(Pick one when we have a website.)

---

## What this policy commits us to

- We will reject features that would create hard dependencies on NVIDIA's stack, even when they would be convenient.
- We will ship Yard (MuJoCo-based) as the canonical demo, not an Isaac Sim demo.
- We will name "Isaac Sim," "Isaac Lab," "Warp," "ovrtx" only as *supported* stacks among others, never as anchors.
- We will resist vendor partnerships that compromise this independence, including financially attractive ones.
- We will revisit this policy only if a major strategic event (acquisition offer, market shift) warrants it. The bar for changing is high.
