# Playground fixtures — proof harness for Range's depth claims

Range's depth-feature claims (`/investigate` finds NaN bugs faster
than raw Codex, `/wire wandb-hydra` patches the canonical foot-guns,
reward functions as first-class entities, etc.) are measured against
a **narrowly-diverged fork of MuJoCo Playground**:

> [`rangeai/mujoco_playground`](https://github.com/rangeai/mujoco_playground)
>
> Local clone: `/Users/<you>/personal/mujoco_playground`

This doc explains how the fork is laid out, how to keep it in sync
with upstream, and how to use the planted-bug branches to reproduce
the benchmark numbers Range cites.

**Each fixture is a self-contained story.** The branch is the
evidence; the comparison run is the data; and a blog post on the
[Range site](https://rangeai.github.io/range/blog/) ties them
together. Pattern per fixture:

  1. **Branch on the fork** with the planted bug as a one-commit diff.
  2. **Two transcripts** — `/investigate` via Range, then the same
     prompt against raw Codex CLI. Both saved verbatim.
  3. **A post** at `site/blog/YYYY-MM-DD-fixture-NN-<slug>.md` with
     hook + bug pattern + naive-debug path + Range path + the numbers.
     Disclaimers up top so we never look like we're saying
     "Google has a NaN bug."
  4. **Optional video** of the Range flow, once the post is solid.

---

## Fork strategy: narrowly diverged

`main` on the fork **tracks upstream `google-deepmind/mujoco_playground`
exactly.** No long-lived divergence — we want to keep pulling in
upstream changes without merge pain.

Every planted bug or experimental fixture lives on its own branch
named `range-fixture-<short-tag>`. Branches are independent of each
other; each one cherry-picks the bug onto a recent upstream commit.

```
upstream/main          ─o─o─o─o─o─o─o─o─o─o─o─  (DeepMind)
                                              \
origin/main            ─o─o─o─o─o─o─o─o─o─o─o─  (fast-forwards only)
                                                \
                          ┌──── range-fixture-cartpole-nan
                          ├──── range-fixture-g1-reward-blowup
                          └──── range-fixture-aloha-stale-sentinel
```

### Why this shape?

- **Credibility:** when a buyer asks "did you find this bug in
  Playground or in your toy fork?" the answer is "real Playground
  code at upstream commit `<sha>`, plus one targeted edit you can
  read in the diff."
- **Maintenance:** rebasing a single-commit branch against new
  upstream releases is cheap. Merging a long-divergent fork is not.
- **Reproducibility:** anyone can `git checkout
  range-fixture-cartpole-nan` and reproduce the comparison run.

---

## Keeping the fork in sync

```bash
cd ~/personal/mujoco_playground

# Add upstream once, if you haven't:
git remote add upstream https://github.com/google-deepmind/mujoco_playground.git

# Periodically:
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
```

For each fixture branch:

```bash
git checkout range-fixture-cartpole-nan
git rebase main
# resolve any conflicts in the planted-bug patch
git push --force-with-lease origin range-fixture-cartpole-nan
```

Done quarterly is fine; weekly is overkill.

---

## Fixture catalog

> **Status:** in progress. The harness itself is being stood up in
> v0.7. Each row below either points at a live branch (with a SHA)
> or marks `planned` until the bug is committed to the fork.

| branch | flow | what's planted | severity | scenario it surfaces in | post |
|---|---|---|---|---|---|
| [`range-fixture-cartpole-reward-nan`](https://github.com/rangeai/mujoco_playground/tree/range-fixture-cartpole-reward-nan) | `/investigate` | **(live)** `log(cos+1)` in `_dense_reward` → `log(0)=-inf` at pole-fully-down → NaN propagates into the value loss. | Subtle | `cartpole_balance` | [fixture-01](https://rangeai.github.io/range/blog/fixture-01-cartpole-reward-nan) |
| [`range-fixture-cartpole-term-guard`](https://github.com/rangeai/mujoco_playground/tree/range-fixture-cartpole-term-guard) | `/investigate` | **(live)** Termination guard relaxed from `.any()` to `.all()` — single-element NaN slips past the guard and contaminates downstream rollouts. | Subtle | `cartpole_balance` | (post pending) |
| [`range-fixture-g1-reward-blowup`](https://github.com/rangeai/mujoco_playground/tree/range-fixture-g1-reward-blowup) | `/investigate` | **(live)** `tracking_lin_vel` weight bumped from 1.0 → 100.0 — gradients on the lin-vel term overwhelm everything else; value loss explodes. | Subtle | `g1_joystick_flat_terrain` | (post pending) |
| [`range-fixture-aloha-stale-sentinel`](https://github.com/rangeai/mujoco_playground/tree/range-fixture-aloha-stale-sentinel) | `/investigate` | **(live)** `distance()` emits `jp.nan` sentinel when grippers within 1e-4 of the box, meant for a removed fallback. Fires only once the policy actually learns to grasp. Seed-dependent. | Hard to find | `aloha_hand_over` | (post pending) |
| `range-fixture-hydra-wandb-broken`       | `/wire wandb-hydra` | (planned) Hydra + W&B integration with the three canonical foot-guns (`start_method`, DictConfig serialization, sweep group key). | Polish | any scenario | — |

---

## Comparison protocol (Range vs. raw Codex)

For each fixture:

1. **Range run.** Fresh session attached to the fixture branch.
   Execute the affected scenario, wait for the failure, type
   `/investigate`. Measure: number of Codex turns to a fix
   proposal + wall-clock time + whether the fix is correct.
2. **Baseline run.** Fresh Codex CLI session (no Range, no
   `/investigate` machinery). Same fixture branch. Same prompt
   shape ("there's a NaN bug in this repo, find and fix it").
   Measure the same three numbers.
3. **Record both** in `docs/proof/results.csv` (this file will land
   when the first fixture goes live). Columns: `fixture`, `harness`
   (`range` | `codex`), `turns`, `wall_clock_s`, `fix_correct`.

The honest framing: if Range's median time-to-fix isn't materially
better than raw Codex on these fixtures, we should know that before
we ship v0.7's marketing.

---

## Open questions

- ~~Do we plant bugs as **branches** or as **commits gated behind an
  env var**?~~ → **Resolved: branches.** Each fixture is a single
  reviewable commit on its own branch. Easy to read, easy to
  reproduce, no env-var bookkeeping at runtime. The cost (only one
  fixture per checked-out workspace at a time) is worth it for
  diff readability.
- Do we publish the comparison numbers? Internal-only is safest
  until we trust them; public is more credible long-term. Lean
  is to publish per-post once we have ≥3 fixtures with consistent
  shape.
