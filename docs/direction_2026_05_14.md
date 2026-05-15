# Direction — 2026-05-14

A short snapshot of where we are, where we're going next, and the
open strategic question.

## Where we are

Range MVP is functional end-to-end. Recent commits land us at:

- Codex auto-starts when a session opens (no buttons)
- Sessions can be created with or without a repo attached; attach a
  repo later via an in-app folder picker
- `range.yaml` parses commands, **scenarios** (parameterized launches),
  **sweeps** (cartesian-product fan-out), and **verification gates**
- Runs are launched with `RANGE_RUN_DIR` / `RANGE_METRICS_FILE` env
  vars; any file dropped in the run dir becomes an artifact in the UI
- Conversation rehydrates from `events.jsonl` on refresh
- Layout: composer pinned at the bottom (Claude Code style),
  conversation auto-sticks to the latest, runs/PR moved into a
  collapsible 460px right rail
- Each run row expands inline with its own log + artifact viewer (no
  global "selected run" panel)
- 5 static mocks in `docs/mocks/` show the longer-arc redesign:
  scenarios, sweeps, comparisons, file edits all render as inline
  conversation cards rather than rail panels

The narrative reframe that drove the recent UX work: **Range is not
an IDE. It's an agentic harness for robot sim developers.** The LLM
picks scenarios, runs sweeps, reads metrics, drafts diffs — the UI
observes, steers, approves.

## What's blocking real progress

I (the user) have never built a robot sim. Every UX decision about
how a sim engineer wants to investigate, tune, regress, or
reproduce has been guess-work informed by personas in docs. The
mocks look real but they encode my outsider intuition, not lived
texture. Decisions about what to expose, what to hide, what's a
button vs what's a chat turn — those should come from feel.

Fix: do the work. Build a tiny robot sim by hand in the same public
stack we already committed to.

## The plan

Pause Range development. Spend an evening (or two) building **Yard
Phase 1** — the spec already exists at `docs/yard_product_spec_v0_1.md`:

- One differential-drive 2-wheel robot, MuJoCo + MJCF
- One 6m × 6m warehouse-style floor with 4–6 static obstacles
- One forward-facing 64×48 depth camera
- One task: navigate start → goal without collision
- One eval: 10-seed success rate

Total: ~30 min for "hello MuJoCo" (load Menagerie model, save a
falling-robot video), then a few sessions of real building over the
following days. Hard cap at 2000 LOC per the Yard spec; the cap is
the point — if it grows past that, the spec failed and the sim is
eating the harness.

The skipped stack for now: Warp. MuJoCo is enough to learn on a
Mac. We come back to Warp once the foundation is grounded.

## Open question (the real one)

**Should Yard be an actual product, or stay strictly as dogfood?**

The current spec says dogfood-only. "Yard is not trying to be a
useful robotics simulator. Failure mode to avoid: Yard becomes the
project, Range becomes the side project."

That framing assumes Range is the unicorn and Yard is overhead. But
two things now push against it:

1. **I'll spend weeks on this regardless.** If I'm going to do the
   work, calling it "throwaway" is artificially limiting. Real
   constraints (users, feedback, scope) sharpen better than
   self-imposed ones.
2. **"Agent-native sim" might be a real wedge.** Existing sims
   (Isaac, Gazebo, Gymnasium, RoboSuite) were not designed assuming
   an LLM would drive them. They expose scenes through XMLs, not
   through scenario manifests with metric contracts. The Range
   contract (`range.yaml` + scenarios + sweeps + metrics) is the
   shape an agent-native sim would already have. If we build Yard
   that way from day one, it has a positioning no incumbent has:
   "the sim built for the agent, not for the human grad student."

Tradeoff if Yard becomes a product:

- Two products instead of one. Solo founders have died of this.
- Or: invert the framing — Yard becomes the product, Range is the
  IDE for Yard. The agentic harness is a feature of an opinionated
  sim, not its own line of business.

Neither answer is obviously right yet. The deciding evidence will
come from the first 2–3 weeks of building Yard: does it feel like
overhead, or does it feel like the real thing? Hold the question
open and look for the answer in the texture.

## Decision for tonight

Build Yard Phase 1 step zero tomorrow:
- `uv init ~/personal/yard && uv add mujoco`
- Download `unitree_go2` from MuJoCo Menagerie
- 20-line script: load model, step physics 5s, save MP4
- Commit. We're a robot sim developer for 30 minutes.

Then the next session of Yard work picks up Phase 1 proper — the
differential-drive bot in the warehouse.
