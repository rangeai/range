# Range

**An agent-driven IDE for engineers training robot policies in
simulation.** Attach a repo (your own, MuJoCo Playground, or
Isaac Lab), Range understands its shape, runs training scenarios,
watches metrics, investigates crashes, edits code, and ships PRs
— all from a chat-first UI backed by Codex.

Built to dogfood through **Yard** ([github.com/rangeai/yard](https://github.com/rangeai/yard)),
a tiny ~1,400-LOC MuJoCo sim that ships planted bugs so we can
live the investigation flows end-to-end.

---

## Status — v0.5

Implemented and verified end-to-end:

- **P1 — Auto-scaffold `range.yaml`** on repo attach. Detects
  MuJoCo Playground and Isaac Lab shapes; proposes a complete
  profile as an inline approval card.
- **P2 — NaN / instability investigation flow.** `/investigate`
  walks `events.jsonl`, identifies the first NaN tick, sends Codex
  a structured trajectory report + investigation directives.
- **P3 — Hydra + W&B integration helper.** `/wire wandb-hydra`
  scans for the canonical broken patterns (missing
  `start_method="thread"`, DictConfig passed unconverted) and
  patches them with per-file approval.
- **P4 — Checkpoints + reward functions as first-class entities.**
  `/eval <checkpoint>` injects `RANGE_CHECKPOINT` for inference
  runs; `/reward show <name>` surfaces declared reward function
  source inline.
- **Lazy-start Codex + idle-shutdown.** No more 30 stale agent
  processes after a day of work.
- **Streaming perf.** Server-side 16ms delta coalescing, deferred
  Markdown rendering, memoized timeline grouping, targeted
  selectors. 5–10× WS frame reduction per turn.

Next on the roadmap: **P5** — plan tracking + interactive
trajectory viewer.

---

## Start here

**You're a new collaborator who just got access.**

1. Read [`docs/user_guide.md`](docs/user_guide.md). ELI5 framing,
   what Range is, the cast of repos, every scenario you can run,
   every slash command, the canonical investigation flows. Built
   for software engineers with zero robotics experience.
2. Then [`docs/dev_setup.md`](docs/dev_setup.md) to get the dev
   server running on your Mac.

**You want the strategic picture.**

1. [`docs/range_product_spec_v0_5_sim_engineer_workflow.md`](docs/range_product_spec_v0_5_sim_engineer_workflow.md)
   — audience analysis, 10 confirmed pain points from field
   research, the prioritized P1–P5 roadmap with explicit
   deprioritization table.

**You want the original product picture.**

1. [`docs/range_prd_v1_0.md`](docs/range_prd_v1_0.md) — earlier
   canonical PRD. Architecture, target stacks, user stories.
   Superseded for direction by the v0.5 spec but still useful
   context.

---

## Repo layout

```
range/
├── README.md                                                   # you are here
├── docs/
│   ├── user_guide.md                                           # ★ start here for new collaborators
│   ├── dev_setup.md                                            # ★ how to install + first run
│   ├── range_product_spec_v0_5_sim_engineer_workflow.md        # ★ v0.5 spec (current direction)
│   ├── direction_2026_05_15.md                                 # decision log: agentic-only, target audience
│   ├── direction_2026_05_14.md                                 # decision log: dogfood vs product
│   ├── range_prd_v1_0.md                                       # original canonical PRD
│   ├── range_positioning_v0_1.md                               # NVIDIA-independence policy
│   ├── range_mvp_spec_v0_1.md                                  # earlier MVP build plan
│   ├── range_scenarios_v0_1.md                                 # original persona walkthroughs
│   ├── range_sim_stack_support_v0_1.md                         # supported stacks
│   ├── range_product_spec_v0_4_codex_sim_streaming.md          # v0.4 spec (architecture, superseded for direction)
│   ├── yard_product_spec_v0_1.md                               # Yard's product spec
│   ├── companion_learnings_v0_1.md                             # what we borrow from Companion (MIT)
│   └── mocks/                                                  # earlier UI mocks
├── ELI_5.md                                                    # robotics sim explained (older intro; user_guide.md is the current one)
├── mockups/                                                    # static HTML mockups from before implementation landed
├── range.yaml                                                  # Range's own profile (for working on Range with Range)
├── web/                                                        # the implementation
│   ├── server/                                                   # Bun + Hono backend
│   │   ├── index.ts                                                # REST + WS routes
│   │   ├── codex.ts                                                # Codex subprocess + JSON-RPC (lazy-start, resume, idle-shutdown)
│   │   ├── scaffold.ts                                             # P1 auto-scaffold (Playground, Isaac Lab detectors)
│   │   ├── trajectory.ts                                           # P2 NaN inspector
│   │   ├── wire.ts                                                 # P3 Hydra+W&B patcher
│   │   ├── profile.ts                                              # range.yaml parser (reward_functions, checkpoints)
│   │   └── ... (runner, runs, sessions, verification, pr, db, hub, log)
│   ├── src/                                                      # React 19 frontend
│   │   ├── views/SessionView.tsx                                   # main chat + composer + inline cards
│   │   ├── views/Home.tsx                                          # session list + new-session composer
│   │   ├── lib/store.ts                                            # Zustand store (memoized, perf-tuned)
│   │   ├── lib/ws.ts                                               # WebSocket dispatcher
│   │   └── lib/api.ts                                              # REST helpers
│   ├── cli/range.ts                                              # the `range` CLI Codex calls into
│   ├── shared/protocol.ts                                        # WS/REST type contract
│   ├── tests/fixtures/                                           # canonical broken setups (e.g. hydra-wandb-broken)
│   └── package.json
└── LICENSE                                                     # MIT
```

---

## Range ↔ Yard

Range and Yard are co-built. Yard is the smallest robotics
simulator that exercises Range's hardest workflows. Every Yard
pain becomes a Range feature requirement, validated by friction
rather than guessed at.

The v0.5 spec ([§7 Test substrate](docs/range_product_spec_v0_5_sim_engineer_workflow.md))
formalizes substrate ordering:

1. **MuJoCo Playground** — primary dogfood (Mac-runnable, real
   audience shape)
2. **Yard** — planted-bug substrate for end-to-end loops
3. **Isaac Lab** — file-shape fixture (no Mac runtime)
4. **tests/fixtures/** — unit-test substrates

---

## License

MIT — see [LICENSE](LICENSE).
