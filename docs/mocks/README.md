# Range mocks — agentic harness for robot sim devs

## Reframe

Range is not an IDE for robot sim. It's an **agentic harness for
robot sim developers** — a chat-first surface where you describe what
you want investigated, tuned, or verified, and an agent (Codex)
picks the right scenarios, runs sweeps, reads metrics, previews
outputs, and proposes diffs. You watch progress and approve changes.

The reframe is forced by two hard truths:

1. **Agentic LLMs are smart.** They can read `range.yaml`, pick the
   right scenario, parse a CI log, choose sweep params, interpret
   metrics, and write a diff. Every button we add for a thing the
   LLM could have figured out itself is a UI tax we're charging the
   user for no reason.
2. **We're building agentic workflows.** That means the LLM drives;
   the UI observes, steers, and approves. It does not navigate menus.

## What the current UI gets wrong

- **Buttons for everything**: scenarios strip, commands strip,
  verification chips, profile commands, run launcher inputs. The
  LLM should pick — the UI should not enumerate. We expose at most
  the *library* of available scenarios as a reference (e.g., for the
  dev who wants to type "run smoke-sweep" as a shortcut), but the
  default path is conversational.
- **Conversation isn't the workspace**: runs live in their own panel,
  artifacts in another, logs in another. The result is that anything
  important happens off-screen; the page keeps growing as runs
  accumulate. Every section pushes the next one down.
- **The live log is invisible.** When something runs, what's
  actually happening live should always be visible — pinned above
  the composer like Claude Code, not buried in a run-detail panel
  the user has to scroll to.

## Design principles for the harness

1. **Conversation is the workspace.** Runs, sweeps, comparisons,
   diffs, artifacts, approvals are all *inline cards* in the
   conversation. There is no "Runs" panel. There is no "Artifacts"
   section. The conversation is everything you need to see, in order.
2. **Composer + live tail are sticky.** The conversation scrolls
   inside its container. The composer is pinned to the bottom of
   the screen. Right above it, a slim activity bar shows the
   currently-running scenario and the latest line of live output.
3. **The LLM picks; the human approves.** The default UI surface
   does not enumerate every command. A user wanting to run a
   scenario types intent ("run the stair sweep across 4 slopes"),
   and the LLM resolves it. The library exists in `range.yaml` but
   doesn't crowd the screen.
4. **Render artifacts where they happen.** A run that produces a
   USD shows the USD inline. A sweep produces a heatmap. A
   regression check produces a comparison table. A reproduction
   produces a traceback card. The visual is the result of the
   activity, not a separate "view results" tab.

## The five critical flows

These are the daily reps for a robot sim dev. Anchored to real
robots in the public ecosystem (Franka, Anymal, UR10, walker
references) and the two stacks we support (MuJoCo and Warp).

1. **Investigate a failing scenario** (`01_investigate.html`) —
   Diagnose intermittent failure in an existing scenario. Sweep
   seeds with instrumentation, locate the failure cluster, propose
   a fix.
   *Persona: Priya (robotics dev).*

2. **Tune a controller across conditions** (`02_tune_sweep.html`) —
   Sweep one or more controller params across environmental
   variations; find the sweet spot; promote a default.
   *Persona: Karthik (controls eng).*

3. **Regression check before merging** (`03_regress.html`) —
   Compare a candidate branch against `main` over the baseline
   scenario suite; surface deltas and trace any regressions.
   *Persona: Anika (platform).*

4. **Author a new scenario from a description**
   (`04_author_scenario.html`) — Translate "UR10 picks cubes off a
   moving conveyor" into scene XML + task code + an initial smoke
   run, iteratively.
   *Persona: Priya.*

5. **Reproduce a CI failure** (`05_reproduce_ci.html`) — Pull a
   failed pipeline job, reproduce locally, bisect the cause, draft
   the fix.
   *Persona: Karthik.*

## How to view

Open `index.html` in any browser. Each mock is a single static HTML
file, no build step. They share `style.css`. Mocks include
realistic fabricated content (robot models, metric numbers,
scenario configs, CI traces) so the workflow reads as a real
session, not a wireframe.
