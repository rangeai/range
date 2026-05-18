---
slug: fixture-02-cartpole-termination-guard
title: A one-character termination-guard bug that silently contaminates training
date: 2026-05-18
description: A planted cartpole bug where the NaN termination guard slipped from .any() to .all() — and what Range's /investigate finds that classical debugging misses.
---

# A one-character termination-guard bug that silently contaminates training

> **Honesty disclaimer.** This bug was **planted by us** in
> [`rangeai/mujoco_playground`](https://github.com/rangeai/mujoco_playground)
> on branch `range-fixture-cartpole-term-guard` to test Range's
> investigation flow against the kind of one-character mistake that
> survives code review. It is **not** a bug in DeepMind's upstream
> MuJoCo Playground.

## TL;DR

- A reviewer "relaxes" the NaN termination guard from `.any()` to
  `.all()`, reasoning that a single bad component is probably a
  numerical hiccup the solver will recover from. Tests pass; the
  PR lands.
- Training runs. Episodes "succeed." Reward curve looks fine until
  it suddenly doesn't.
- **Raw Codex:** _N_ turns, _M_ minutes, _correct fix? Y/N_. *(numbers pending)*
- **Range + `/investigate`:** _N_ turns, _M_ minutes, fix in first response. *(numbers pending)*

## The bug

[Branch on the fork →](https://github.com/rangeai/mujoco_playground/tree/range-fixture-cartpole-term-guard)
· [Commit diff →](https://github.com/rangeai/mujoco_playground/commit/da5a78d)

```diff
 else:
-  done = jp.isnan(data.qpos).any() | jp.isnan(data.qvel).any()
+  # Only terminate if every state component is NaN — a single bad
+  # element is probably a numerical hiccup from one substep.
+  done = jp.isnan(data.qpos).all() | jp.isnan(data.qvel).all()
   done = done.astype(float)
```

`any()` → `all()`. One word. The intent reads plausibly. The
consequence is that a single NaN element in qpos or qvel — which
happens periodically under sharp contact transitions — slips past
the guard. The episode keeps running with a contaminated state.
Reward is computed from the bad state. Gradients propagate the NaN.
PPO trains on garbage.

## Why this kind of bug actually happens

- The fix looks defensive. `.any()` does trip on the very first NaN
  element, which is "more aggressive than necessary" if you believe
  MuJoCo's solver self-corrects. So someone reads the existing code
  and thinks, *I'll make this less twitchy.*
- The symptom is silent. The run doesn't crash. Metrics get logged.
  W&B looks normal for hundreds of episodes. The damage is in the
  policy weights, not the dashboard.
- Tests rarely exercise the contact-transition path that produces
  the transient NaN, so CI passes.

## The naive debug path (no Range)

Skim W&B → reward curve eventually goes weird → guess hyperparams →
re-run with different seeds → notice the divergence is seed-
dependent but reproducible → add print statements → discover NaN in
qpos mid-episode → trace back to the termination guard.

Wall-clock if you happen to think "maybe it's the termination
guard": ~30 minutes. If you don't: hours.

## The Range path

1. Run `/cartpole_balance` against the fixture branch. It "succeeds"
   with degraded metrics.
2. `/investigate` (with the P1 fix landed, falls back to the latest
   run when no failure exists).
3. Range walks `events.jsonl`, finds the first tick where qpos or
   qvel went NaN, captures the last 5 clean ticks + first 5
   contaminated ticks, hands Codex a structured report.
4. Codex reads the report, opens `cartpole.py`, sees the
   `.all()`-guarded `done` predicate, proposes the one-character
   fix.

The pre-loaded structured trajectory means Codex doesn't have to
guess where to look — it gets the *exact* tick the contamination
started.

## Results

| harness  | turns | wall-clock | fix correct? |
|----------|-------|------------|--------------|
| Range    | —     | —          | —            |
| Codex CLI| —     | —          | —            |

*(populated after comparison runs)*

## What this tells us about Range

If the numbers hold, **Range is most useful exactly when the bug is
silent.** A crashed run grabs your attention; a quietly contaminated
one doesn't. The trajectory report compresses an hour of "where do
I even look" into a structured artifact Codex can act on.

---

*Second in a series of fixture posts on
[`rangeai/mujoco_playground`](https://github.com/rangeai/mujoco_playground).
Catalog: [`docs/playground_fixtures.md`](https://github.com/rangeai/range/blob/main/docs/playground_fixtures.md).*
