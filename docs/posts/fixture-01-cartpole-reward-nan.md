# Finding a one-line reward bug in MuJoCo Playground with Range

> **Honesty disclaimer.** This bug was **planted by us** in
> [`rangeai/mujoco_playground`](https://github.com/rangeai/mujoco_playground)
> on branch `range-fixture-cartpole-reward-nan` to test Range's
> investigation flow against a realistic-looking change. It is **not**
> a bug in DeepMind's upstream MuJoCo Playground. The whole point of
> the exercise is to measure whether Range helps find this class of
> bug faster than raw Codex — see the "results" section below.

## TL;DR

- Someone "improves" cartpole's reward by replacing `(cos+1)/2` with
  `log(cos+1)/2`. Innocuous-looking. Reviewer LGTMs. CI passes.
- Training launches, runs for a while, then the value-loss curve
  goes haywire. Reward is silently `nan` in a chunk of timesteps.
- **Raw Codex:** _N_ turns, _M_ minutes, _correct fix? Y/N_.
  *(numbers go here once the comparison run is done)*
- **Range + `/investigate`:** _N_ turns, _M_ minutes, fix proposed
  in the first response. *(numbers go here)*

The interesting part isn't the bug. It's the workflow delta:
Range hands Codex a structured trajectory report (first-NaN tick,
affected fields, last 5 clean ticks, first 5 contaminated ticks)
that Codex can't get on its own.

## The bug

[Branch on the fork →](https://github.com/rangeai/mujoco_playground/tree/range-fixture-cartpole-reward-nan)
[Commit diff →](https://github.com/rangeai/mujoco_playground/commit/6b3ef4b)

```diff
   pole_angle_cos = data.xmat[2, 2, 2]
-  upright = (pole_angle_cos + 1) / 2
+  # Make reward more sensitive near the upright state — sharper
+  # gradient where it matters, flatter where the pole has already
+  # fallen and there's nothing to learn.
+  upright = jp.log(pole_angle_cos + 1) / 2
```

One line, plausible motivation, accidentally introduces `log(0)`
when the pole is fully down (`cos = -1`). Early-training exploration
sees fully-down poses all the time, so the reward goes `-inf →
nan`, that propagates into the loss, and PPO's policy gradient
quietly turns into noise.

The naive symptom is "training plateaued, the policy doesn't learn
to balance." The actual cause is in the reward function.

## Why this kind of bug actually happens

A few real-world patterns that produce this exact shape of mistake:

- **Domain math that's correct in the limit, wrong at the boundary.**
  `log(cos+1)` *is* a more sensible gradient near upright — the
  function is just undefined at the opposite end. Easy to miss in a
  PR review if the reviewer thinks about the typical case, not the
  edge.
- **Reward shaping iteration.** Teams iterate on reward terms
  daily. Most edits are 1–3 lines. Most don't get a dedicated test.
- **The signal is at the wrong layer.** Training "succeeds" — runs
  finish, metrics get logged, W&B looks normal until you stare at
  the value-loss curve and realize it's not converging.

## The naive debug path (no Range)

What you'd probably do without a structured investigation flow:

1. Notice the policy isn't learning. Look at W&B.
2. Reward curve looks fine (mean over batch is non-nan because some
   episodes don't hit the `cos=-1` region).
3. Add `print` / `jax.debug.print` to the training loop. Re-launch.
4. See `nan` in one of the per-timestep reward components after a
   few minutes of training.
5. Read `_dense_reward` line by line. Notice `jp.log(pole_angle_cos + 1)`.
6. Realize `cos=-1` → `log(0)` → `-inf` → `nan`. Fix.

Wall-clock if you know what you're looking for: ~15–30 minutes.
Wall-clock if you don't: an afternoon, because the symptom looks
like a hyperparameter problem first.

## The Range path

[Range conversation transcript →](transcripts/fixture-01-range.md)
*(placeholder — written once the run is done)*

1. `git checkout range-fixture-cartpole-reward-nan` in the
   Playground clone Range is attached to.
2. `/cartpole_balance` — training runs, reward goes NaN, run state
   eventually flips to "failed" (or completes with a bad metric;
   either way the trajectory is contaminated).
3. `/investigate` — Range walks `events.jsonl`, finds the first
   NaN tick, captures the last 5 clean + first 5 contaminated
   ticks, identifies the affected fields (in this case:
   `reward/upright` and downstream `reward`).
4. Codex gets handed a structured report. It reads
   `_dense_reward`, sees `jp.log(pole_angle_cos + 1)`, infers the
   domain issue, proposes the fix.

The structured trajectory report is the part raw Codex can't
generate on its own — it'd have to ask the user to grep through
the logs, which means the user has to know that the logs are even
the place to look.

## The Codex-alone baseline

[Codex CLI transcript →](transcripts/fixture-01-codex.md)
*(placeholder — written once the run is done)*

Same starting point: branch checked out, training was just run and
failed. Codex CLI session, no Range context, opening prompt
something like *"my MJX cartpole training is producing NaN reward
— can you find and fix it?"*. Measure the same three numbers.

## Results

| harness  | turns | wall-clock | fix correct? | notes |
|----------|-------|------------|--------------|-------|
| Range    | —     | —          | —            | —     |
| Codex CLI| —     | —          | —            | —     |

*(table populated after comparison runs)*

## What this tells us about Range

Two things, if the numbers hold up:

1. **The structured trajectory report is load-bearing.** It's the
   piece neither raw Codex nor a human can produce in 30 seconds.
2. **Range is most useful at the seam between "training failed"
   and "I know where to look."** That's where most of the debugging
   wall-clock lives in real teams, and that's the gap Range
   collapses.

If the numbers *don't* hold up — Range comes in at parity with raw
Codex, or worse — we should know that, and this post will say so.
Public proof harness or it didn't happen.

---

*This is the first in a series of fixture posts measuring Range's
debugging value against named, plausible bugs in
MuJoCo Playground. Catalog: [`docs/playground_fixtures.md`](../playground_fixtures.md).*
