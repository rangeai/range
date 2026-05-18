---
slug: fixture-03-g1-reward-blowup
title: A single missing decimal blows up G1 locomotion training
date: 2026-05-18
description: A planted MuJoCo Playground bug where a reward weight is 100× too big — training never converges, and Range's /investigate finds it from the divergent run alone.
---

# A single missing decimal blows up G1 locomotion training

> **Honesty disclaimer.** This bug was **planted by us** in
> [`rangeai/mujoco_playground`](https://github.com/rangeai/mujoco_playground)
> on branch `range-fixture-g1-reward-blowup`. **Not** a bug in
> DeepMind's upstream Playground.

## TL;DR

- Someone bumps `tracking_lin_vel` from `1.0` to `100.0` on the G1
  joystick task — looks like emphasis, easy to PR-ack.
- Training never converges. Value loss explodes by step 5k. Some
  seeds NaN, others just sit at zero reward.
- **Raw Codex:** _N_ turns, _M_ minutes, _correct fix? Y/N_. *(numbers pending)*
- **Range + `/investigate`:** _N_ turns, _M_ minutes, fix in first response. *(numbers pending)*

## The bug

[Branch on the fork →](https://github.com/rangeai/mujoco_playground/tree/range-fixture-g1-reward-blowup)
· [Commit diff →](https://github.com/rangeai/mujoco_playground/commit/97ea9da)

```diff
   reward_config=config_dict.create(
       scales=config_dict.create(
           # Tracking related rewards.
-          tracking_lin_vel=1.0,
+          tracking_lin_vel=100.0,
           tracking_ang_vel=0.75,
           ...
```

The other tracking weights are O(1). One reward term being 100×
larger than its peers means PPO's gradient on that term dominates
every update. The agent ends up steering its entire policy toward
satisfying lin-vel tracking at the expense of every other term —
including the ones that keep the humanoid upright. Value loss
explodes within a few thousand steps.

## Why this kind of bug actually happens

- Reward shaping iterates daily. Most edits are 1–3 lines.
- `1.0 → 100.0` reads as "I'm prioritizing this." A reviewer might
  not immediately do the unit-comparison.
- The bug shows up as "training doesn't work" — generic enough that
  the first instinct is to bisect hyperparams, not reward weights.

## The naive debug path (no Range)

Run sweeps over learning rate, batch size, episode length → none of
them fix it → suspect the env → start dumping reward components per
step → notice tracking_lin_vel is dominating the metric mix → check
the config → spot the 100.

Wall-clock if you happen to suspect reward weights: ~45 minutes.
If you don't: an afternoon of hyperparam search first.

## The Range path

1. `/g1_joystick_flat_terrain` against the fixture branch — value
   loss diverges within a couple hundred steps.
2. `/investigate` picks up the run, walks its `events.jsonl`, finds
   the first per-component reward that goes pathological, and hands
   Codex a report citing `reward/tracking_lin_vel` as the
   disproportionate signal.
3. Codex reads `joystick.py`, sees the `tracking_lin_vel=100.0`
   line, proposes the fix.

The signal is in the reward-component time-series. Range's
trajectory walker pulls it out without the user having to log
extra metrics or write a debugging notebook.

## Results

| harness  | turns | wall-clock | fix correct? |
|----------|-------|------------|--------------|
| Range    | —     | —          | —            |
| Codex CLI| —     | —          | —            |

*(populated after comparison runs)*

## What this tells us about Range

Reward-weight bugs aren't NaNs. They aren't crashes. They show up
as "training feels wrong." Range's `/investigate` was originally
NaN-flavored; what this fixture exercises is the broader claim
that **per-component reward time-series + a structured handoff to
Codex** generalizes past NaN to silent-failure bugs too.

---

*Third in the series.
[Catalog →](https://github.com/rangeai/range/blob/main/docs/playground_fixtures.md)*
