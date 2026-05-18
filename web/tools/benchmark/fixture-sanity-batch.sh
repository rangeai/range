#!/usr/bin/env bash
# Lightweight sanity-check batch over all live fixture branches.
#
# For each fixture branch on rangeai/mujoco_playground, run a SHORT
# training pass on the affected scenario and capture evidence the
# planted bug fires (NaN/Inf in stdout/stderr). NOT a Range-vs-Codex
# comparison — that needs real GPU time. This script just answers
# "does each fixture's bug actually surface within ~5000 steps."
#
# Output: /tmp/range-fixture-sanity/<branch>.log
#
#   bash web/tools/benchmark/fixture-sanity-batch.sh

set -u
FORK="${FORK:-$HOME/personal/mujoco_playground}"
OUT="${OUT:-/tmp/range-fixture-sanity}"
STEPS="${STEPS:-5000}"
mkdir -p "$OUT"

# Plain parallel arrays — bash associative arrays parse hyphens in
# unquoted keys as arithmetic minus, and quoting `[ ... ]=val` is
# version-sensitive. Two arrays in lockstep are boring but reliable.
FIXTURE_BRANCHES=(
  "range-fixture-cartpole-reward-nan"
  "range-fixture-cartpole-term-guard"
  "range-fixture-g1-reward-blowup"
  "range-fixture-aloha-stale-sentinel"
)
FIXTURE_ENVS=(
  "CartpoleBalance"
  "CartpoleBalance"
  "G1JoystickFlatTerrain"
  "AlohaHandOver"
)

cd "$FORK"

# Stash before we start touching branches; restore at the end.
git stash -u >/dev/null 2>&1 || true
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)

PASSED=0
FAILED=0

for i in "${!FIXTURE_BRANCHES[@]}"; do
  branch="${FIXTURE_BRANCHES[$i]}"
  env_name="${FIXTURE_ENVS[$i]}"
  log="$OUT/$branch.log"
  echo "=== $branch ($env_name) ==="
  git checkout "$branch" 2>&1 | tail -1

  # Time-cap each run hard so we don't hang the batch on a runaway.
  ( perl -e 'alarm shift; exec @ARGV' 600 \
      .venv/bin/python learning/train_jax_ppo.py \
      --env_name="$env_name" \
      --num_timesteps="$STEPS" ) > "$log" 2>&1
  exit_code=$?

  # Verdict: did the bug surface?
  if grep -iE "nan|inf|invalid value|RuntimeWarning|Traceback" "$log" > /dev/null; then
    echo "  ✓ bug fired (signal found in log)"
    PASSED=$((PASSED + 1))
  else
    echo "  ✗ no NaN/Inf/error in log (exit=$exit_code, $(wc -l < "$log") lines)"
    FAILED=$((FAILED + 1))
  fi
done

git checkout "$ORIGINAL_BRANCH" 2>&1 | tail -1
git stash pop >/dev/null 2>&1 || true

echo
echo "=== summary ==="
echo "passed: $PASSED"
echo "failed: $FAILED"
echo "logs under: $OUT"
