# Contributing to Range

Glad you're here. Range is a small enough codebase that you can have
a real change merged in an afternoon. This doc tells you how.

## What Range is, in one line

A chat-first IDE for engineers training robot policies in simulation,
built on Bun + TypeScript + React with Codex (or OpenCode) as the
agent backend. The [`README`](README.md) has the longer pitch;
[`docs/user_guide.md`](docs/user_guide.md) walks you through using
it end-to-end.

## Getting your dev environment running

It's the same setup as a regular user — there's no "contributor
mode." Follow [`docs/dev_setup.md`](docs/dev_setup.md). About 5–10
minutes if you already have `bun`, `git`, and an agent CLI
installed.

After that:

```bash
cd web
bun install
bun run dev          # starts server on :3457 + Vite on :5173
bun run typecheck    # tsc -b --noEmit
```

Range has no formal test suite yet (it's something we'd love help
with — see [Open priorities](#open-priorities) below). The current
"passes" bar is **`bun run typecheck` clean + the SB3-zoo
walkthrough in the user guide still works manually.**

## Learning the codebase

Three docs to read, in order:

1. [`docs/contributing/architecture.md`](docs/contributing/architecture.md)
   — A focused tour of the codebase. ~15 min read.
2. [`docs/contributing/product_spec.md`](docs/contributing/product_spec.md)
   — What we're building and the prioritized roadmap.
3. [`docs/contributing/positioning.md`](docs/contributing/positioning.md)
   — Hard product rules (e.g., Range stays NVIDIA-independent —
   integrations only via public repos).

If you want historical context on how we got here, the
[direction notes](docs/contributing/direction/) are time-stamped
strategy snapshots.

## How we work

- **One feature per PR.** Squash-merged into `main`.
- **`main` is always shippable.** No long-lived feature branches in
  the public repo.
- **TypeScript strict mode.** `bun run typecheck` should be green
  before you open a PR.
- **React + Zustand for state.** No Redux. No new state libraries
  without discussion.
- **Hono on Bun for the server.** Avoid pulling in Express/Fastify.

## Code conventions

- **Default to no comments.** Well-named identifiers should carry
  intent. Add a comment only when the *why* is non-obvious — a
  hidden constraint, a workaround for a specific bug, a subtle
  invariant. If the comment would just narrate *what* the code
  does, delete it.
- **Validate at boundaries, not internals.** Sanitize user input
  and external API responses; trust your own code paths.
- **Prefer editing existing files** to creating new ones. Resist
  the urge to spin up a new module for a 30-line helper.
- **No backwards-compatibility shims** unless we have an external
  contract to honor.
- **Errors should travel.** Return them, log them, or surface them
  in the UI; never swallow them silently.

## Submitting a PR

1. Fork `rangeai/range`.
2. Branch from `main`.
3. Make your changes; keep the diff focused.
4. `cd web && bun run typecheck` — green.
5. Push and open a PR against `rangeai/range:main`.
6. Describe the change in the PR body: what changed, why, how
   you tested it (e.g., "ran SB3-zoo onboarding flow,
   `/cartpole_balance` succeeded").

## Open priorities

These are real things we'd love help with. Pick anything that
catches your interest:

- **Profile cache invalidation bug** — when the agent edits
  `range.yaml` mid-session, the client's slash picker doesn't
  refresh. See task #153 in our backlog.
- **Test scaffolding.** Range has no formal test suite. A first
  pass of integration tests against `/cartpole_balance` would be
  enormously valuable.
- **Stack-specific scaffolds.** Today we have detectors for MuJoCo
  Playground and Isaac Lab, plus a generic Python fallback.
  Detectors for rl_games, PufferLib, ml-agents, ManiSkill, etc.
  would all be welcome.
- **Argparse / click / Hydra inference** in the generic Python
  detector. Today the scaffolder emits `python train.py` with no
  args; reading the entrypoint's CLI schema would let it
  pre-populate sensible flags.

## Where to ask questions

- Open a [discussion](https://github.com/rangeai/range/discussions)
  for design questions.
- Open an [issue](https://github.com/rangeai/range/issues) for
  bugs.

## License

Range is MIT-licensed. By contributing, you agree your changes can
be released under the same license. See [`LICENSE`](LICENSE).
