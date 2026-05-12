# Range

**A Codex-first development harness for simulation-heavy software.**

This repository holds the product specifications, scenario walkthroughs, and UX mockups for Range — a development tool that gives Codex a *proving ground* for robotics, simulation, training, and physical-AI work. Range itself isn't built yet. The artifacts here define what we're building before we build it.

---

## Status

**Pre-implementation.** The repo currently contains documents and mockups — no source code. The next concrete step is Phase 1 of the Range MVP spec: wiring the mockups to a real backend and running the first end-to-end session against **Yard** (a paired, deliberately minimal robotics sim built for dogfooding).

---

## What's in this repo

| Type | File | What it is |
|---|---|---|
| **★ Canonical PRD** | [`docs/range_prd_v1_0.md`](docs/range_prd_v1_0.md) | **The authoritative product reference.** Vision, problem, users, user stories, UX wireframes, architecture, target stacks, roadmap. Start here. |
| Positioning | [`docs/range_positioning_v0_1.md`](docs/range_positioning_v0_1.md) | NVIDIA-independence policy, audience commitments, allowed/forbidden dependencies |
| Stack support | [`docs/range_sim_stack_support_v0_1.md`](docs/range_sim_stack_support_v0_1.md) | Top-2 stacks officially supported (MuJoCo, ROS 2 + Gazebo) with reasoning |
| Intro | [`ELI_5.md`](ELI_5.md) | What Yard is and the components used to build it, for engineers new to robotics simulation |
| MVP spec | [`docs/range_mvp_spec_v0_1.md`](docs/range_mvp_spec_v0_1.md) | The scoped MVP build plan — phases paired with Yard |
| Sim project | [`docs/yard_product_spec_v0_1.md`](docs/yard_product_spec_v0_1.md) | Yard — the deliberately tiny robotics simulator we use to dogfood Range |
| Scenarios | [`docs/range_scenarios_v0_1.md`](docs/range_scenarios_v0_1.md) | Three first-walkthrough scenarios across personas (Priya / Anika / Karthik) |
| Learnings | [`docs/companion_learnings_v0_1.md`](docs/companion_learnings_v0_1.md) | What we borrow, build, and avoid from The-Vibe-Company/companion (MIT-licensed Codex/Claude Code orchestration UI) |
| Earlier spec | [`docs/range_product_spec_v0_4_codex_sim_streaming.md`](docs/range_product_spec_v0_4_codex_sim_streaming.md) | Original v0.4 product spec — kept as historical reference; superseded by the PRD |
| Mockups | [`mockups/`](mockups/) | Six self-contained HTML mockups covering the app's main surfaces |

---

## Where to start

Different reading paths depending on what brought you here.

**You want the canonical product picture.**
1. Read [`docs/range_prd_v1_0.md`](docs/range_prd_v1_0.md) — vision, users, user stories, UX wireframes, architecture, roadmap. Self-contained.

**You want to *see* what we're building.**
1. Open [`mockups/mockup-index.html`](mockups/mockup-index.html) in a browser.
2. Click through the five linked screens (auth → home → live session → freeform → plan).

**You're new to robotics simulation.**
1. Read [`ELI_5.md`](ELI_5.md).
2. Then [`docs/range_prd_v1_0.md`](docs/range_prd_v1_0.md) for the product picture.

**You're planning to implement.**
1. Start with [`docs/range_prd_v1_0.md`](docs/range_prd_v1_0.md) for product context.
2. Then [`docs/range_mvp_spec_v0_1.md`](docs/range_mvp_spec_v0_1.md) for the phased build plan with P0/P1 cuts and resolved decisions.

---

## Repo structure

```
range/
├── README.md                                                   # You are here
├── ELI_5.md                                                    # Robotics sim explained for engineers new to it
├── .gitignore
├── docs/
│   ├── range_prd_v1_0.md                                       # ★ Canonical PRD — start here
│   ├── range_positioning_v0_1.md                               # NVIDIA-independence policy
│   ├── range_sim_stack_support_v0_1.md                         # Top-2 stacks (MuJoCo, ROS 2 + Gazebo)
│   ├── range_mvp_spec_v0_1.md                                  # Phased MVP build plan
│   ├── range_scenarios_v0_1.md                                 # Three persona-anchored walkthrough candidates
│   ├── yard_product_spec_v0_1.md                               # The paired dogfood sim project
│   ├── companion_learnings_v0_1.md                             # What we borrow from Companion (MIT)
│   └── range_product_spec_v0_4_codex_sim_streaming.md          # Original v0.4 — historical reference
└── mockups/
    ├── mockup-index.html                                       # Launcher — start here, links the rest
    ├── mockup-auth.html                                        # Connect GitHub / Jira / Slack flow
    ├── mockup-home.html                                        # Default view with conversational composer
    ├── mockup-plan.html                                        # All PRs across sessions
    ├── mockup-session-freeform.html                            # Freeform chat session, no tracked task
    └── mockup-implementation.html                              # Live Codex session with evidence streaming
```

---

## How to view the mockups

The mockups are static HTML files with Tailwind loaded via CDN. **No build step. No install.** To view:

1. Clone the repo
2. Open [`mockups/mockup-index.html`](mockups/mockup-index.html) in any modern browser
3. Click through

Each mockup has a light/dark theme toggle in the top bar. Preference persists across screens via `localStorage`. Default reads the system color-scheme preference.

---

## The Range ↔ Yard relationship

Range and Yard are co-built. Yard is the smallest robotics simulator that exercises Range's hardest workflows. Every Yard pain becomes a Range feature requirement, validated by frustration rather than guessed at.

Both specs are phased to pair. Phase 1 of Range MVP ships when Phase 1 of Yard works inside it. Phase 2 of Range MVP enables the first evidence-backed PR against a Yard bug. Phase 3 stresses the cross-layer (cross-repo) verification flow.

See [`docs/yard_product_spec_v0_1.md`](docs/yard_product_spec_v0_1.md) §4 and [`docs/range_mvp_spec_v0_1.md`](docs/range_mvp_spec_v0_1.md) §5 for the paired phasing.

This pattern — dogfooding through a paired minimal product — is the strategy, not an accident.

---

## Working conventions

- Specs are versioned in their filename (e.g., `_v0_4`, `_v0_1`) so future iterations don't overwrite history
- Markdown specs live in [`docs/`](docs/)
- HTML mockups live in [`mockups/`](mockups/), each self-contained (open one without the others)
- The repo is intentionally lightweight at this stage; we'll add structure (e.g., a `src/` tree) when there's code to put in it
- Commits squash-merge friendly; messages describe intent, not just scope

---

## License

MIT — see [LICENSE](LICENSE).
