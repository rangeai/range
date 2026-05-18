---
slug: fixture-04-aloha-stale-sentinel
title: The bug that only shows up once your policy gets good
date: 2026-05-18
description: A planted Aloha manipulation bug that emits a NaN sentinel only when grippers grasp tightly — seed-dependent and impossible to find via grep.
---

# The bug that only shows up once your policy gets good

> **Honesty disclaimer.** This bug was **planted by us** in
> [`rangeai/mujoco_playground`](https://github.com/rangeai/mujoco_playground)
> on branch `range-fixture-aloha-stale-sentinel`. **Not** a bug in
> DeepMind's upstream Playground.

## TL;DR

- Six months ago, someone added a `jp.nan` sentinel to the
  manipulation distance function. The plan was for a downstream
  contact-phase reward to consume it. The contact-phase reward
  never landed. The sentinel stayed.
- Training looks fine. Eventually, on *some* seeds, once the policy
  learns to grasp tightly, gripper-to-box distance drops below
  1e-4 and the reward goes NaN mid-episode. Loss diverges.
- **Raw Codex:** _N_ turns, _M_ minutes, _correct fix? Y/N_. *(numbers pending)*
- **Range + `/investigate`:** _N_ turns, _M_ minutes, fix in first response. *(numbers pending)*

## The bug

[Branch on the fork →](https://github.com/rangeai/mujoco_playground/tree/range-fixture-aloha-stale-sentinel)
· [Commit diff →](https://github.com/rangeai/mujoco_playground/commit/b5834de)

```diff
   def _get_reward(self, data: mjx.Data, info: Dict[str, Any]) -> Dict[str, Any]:
     def distance(x, y):
-      return jp.exp(-10 * jp.linalg.norm(x - y))
+      # When the gripper sits flush against the box surface, the
+      # exp(-10*d) term saturates at 1 and the gradient vanishes.
+      # Emit a sentinel for the caller to detect and apply a contact-
+      # phase reward instead. See proposals/contact_phase_reward.md.
+      d = jp.linalg.norm(x - y)
+      return jp.where(d < 1e-4, jp.nan, jp.exp(-10 * d))
```

The sentinel is conditional on `d < 1e-4`. Most of training, this
branch never fires — the gripper isn't close enough. Once the
policy learns to grasp the box tightly, suddenly the threshold
trips. NaN propagates into the reward, then the loss, then the
gradient. Some seeds get there sooner than others.

## Why this kind of bug actually happens

- **Stale-sentinel** is a recognized antipattern. Code lands that
  expects a downstream consumer to exist. The consumer slips. The
  sentinel doesn't.
- **The bug is policy-conditional.** It doesn't fire under random
  exploration. It only fires *after* training has done its job. So
  it looks like late-training divergence, not a coding error.
- **Seed-dependent reproduction.** The classical "run it 5 times
  and look for a pattern" doesn't help when only 2/5 seeds even
  reach the conditions that trigger it.

## The naive debug path (no Range)

Look at W&B → reward goes NaN at step 25k on seed 2 but seed 1
trained fine to step 50k → check for NaN-producing ops with grep →
the explicit `jp.nan` in `distance()` is the obvious match → realize
nothing consumes the sentinel → fix.

This actually has a decent grep target (`jp.nan` in a reward fn is
unusual). Wall-clock if you're systematic: ~20 minutes. If you
chase a hyperparameter rabbit hole first: hours.

## The Range path

1. `/aloha_hand_over` against the fixture branch, multi-seed.
2. Eventually a seed diverges. `/investigate` picks up the failed
   run.
3. Range walks the trajectory, finds the first NaN-tainted tick,
   and notes which reward components went bad. Aloha's reward
   composes 4 distance terms — Range identifies which one
   specifically.
4. Codex reads `_get_reward`, sees the explicit `jp.nan` in the
   distance branch, traces the comment ("see proposals/..."),
   confirms no caller consumes the sentinel, proposes the fix.

The Range win here is the **per-component reward forensics**.
Without it, "the reward went NaN" tells you nothing about which
of the four reward terms — `gripper_box`, `box_handover`,
`handover_target`, `no_table_collision` — was actually responsible.

## Results

| harness  | turns | wall-clock | fix correct? |
|----------|-------|------------|--------------|
| Range    | —     | —          | —            |
| Codex CLI| —     | —          | —            |

*(populated after comparison runs)*

## What this tells us about Range

Stale-sentinel bugs are the kind reviewers write off as harmless.
The discovery hinges on **someone running the code far enough for
the conditional branch to fire**. Range's structured run-walking
collapses "did it ever fire?" from a manual grep to a single
report — independent of how late in training the bug manifested.

---

*Fourth in the series.
[Catalog →](https://github.com/rangeai/range/blob/main/docs/playground_fixtures.md)*
