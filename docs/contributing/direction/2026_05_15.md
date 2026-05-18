# Direction — 2026-05-15

Updates `direction_2026_05_14.md`. The strategic question we left
open ("should Yard be a product?") is answered. We also know what
to build in Range next, in detail.

## What changed since yesterday

I lived inside the workflow: attached `~/personal/yard` as a Range
session, ran scenarios, flipped on `YARD_BUG_DEPTH_CLIP=1`, walked
through the Anika investigation flow against real failures rather
than mocked ones.

Two findings, both decisive.

### 1. The right rail has to die

It was the right interim move yesterday (when I needed the
launchers visible without scrolling), but with real usage it
becomes structural noise. The conversation is where the work
*is*; every panel on the right is a context-switch tax. Mid-
investigation I was constantly bouncing my eyes from the chat
thread to the runs list to the artifact panel and back — same
information presented in two different visual languages, neither
fully telling the story.

The mocks I built two days ago are the right answer. **Runs,
sweeps, metrics, artifacts, diffs, approvals — all inline cards
inside the conversation.** No right rail. No separate "Runs"
section. Composer + activity bar pinned at the bottom; conversation
is the whole workspace.

### 2. Agentic-only is non-negotiable

I kept reaching for the LLM-not-the-UI. The pattern emerged
quickly: I'd type "investigate why warehouse_a is collapsing"
expecting Codex to pick the right scenarios, sweep them, surface
the failure — and I'd find myself looking at the right rail's
button-grid wondering why I have to manually click through five
chips when an LLM standing next to me could do it.

The button-grid UX bakes in the assumption that the *user* picks
what to run. For our target audience that assumption is wrong.

## Target audience (now explicit)

**Range is the agentic IDE for engineers using Isaac Sim / Isaac
Lab, MuJoCo / MJX, or any general-purpose robot-training stack.**

These users:

- Are ML / robotics engineers at humanoid companies, NVIDIA-adjacent
  shops, university robotics labs.
- Already run sweeps and regressions via Python + shell + tmux.
- Already use Cursor / Claude Code for code edits.
- Don't need a generic dashboard; they need an *agent-aware
  orchestrator* that knows sim concepts (scenarios, sweeps,
  metrics, artifacts, regression suites) and lets them describe
  intent in natural language.

Crucially: they don't need education about robot sim. They need
fewer panels and a smarter agent.

## What this commits us to

### Range is the product

Range's UX bet: chat-first, runs/artifacts/metrics rendered inline
in the conversation, the LLM picks what to do. Distribution is
open-source-first; the contract is `range.yaml` so any sim repo
can attach.

### Yard is strict dogfood

Yard's v0.1 framing holds. We don't expand it past the 2,000-LOC
cap. Don't add humanoid scenarios, don't add training loops, don't
turn it into a sim platform. Its only job is to surface workflows
that sharpen Range. When we need to test Range against Isaac
Sim/Lab specifically, we do that against the public Isaac Lab
repo — not by growing Yard.

### What we don't do

- Build "Range Cloud" before the local product is sharp
- Build a Range CLI (yet) — the chat surface is the differentiator
- Add a notebooks integration before agentic-only is real
- Compete with Weights & Biases on training-curve dashboards.
  W&B integration via link-out is fine; building our own is scope
  creep.

## The refactor that follows (this week)

1. **Inline run cards.** Add a `run` conversation-entry kind.
   When a run starts (regardless of who started it), it lands as
   a card in the conversation. As metrics, artifacts, and the
   run-finished event arrive, the card updates in place.
2. **Sweep cards.** Multi-seed sweeps render as a single
   conversation entry with nested per-variant cards (matching the
   right-rail look, but inline).
3. **Right rail removed entirely.** SessionView becomes a single
   column: header, scrolling conversation, pinned composer.
4. **Slash-command picker in composer.** Typing `/` opens a small
   inline picker over the composer listing the scenarios and
   commands declared in `range.yaml`. Selecting one launches the
   run and the resulting card appears in the conversation. This
   replaces the deleted scenario/command/verification strips for
   manual launch. Eventually Codex itself launches scenarios via
   tool use; for now slash commands cover the gap.
5. **PR drafting as an inline card.** No more PR section at the
   bottom. The PR draft + open flow becomes an inline approval
   card, triggered by `/pr` or by Codex requesting it.

Live-test against Yard after each step. Commit per step.

## Open follow-ups (not this week)

- **Codex tool use.** For the loop to feel truly agentic, Codex
  needs the ability to *call* scenario-launch / sweep / regress
  itself when the user describes intent. That's a backend change
  in `server/codex.ts` plus a tool definition. Defer until the
  visual refactor lands.
- **Isaac Lab dogfood.** Once the agentic-only UX is in, attach
  the public Isaac Lab repo with a `range.yaml` we author and run
  one of their sample scenarios through Range. That's the
  "audience-validation" demo.
- **Training-curve view.** Once a real RL run completes, we want
  the loss / reward curves rendered inline. Defer — first we need
  a real training run to render against.

## What's no longer true from yesterday's doc

The line "hold the question open and look for the answer in the
texture" — the texture spoke. Yard stays dogfood. Range is the
product. Today's work is the first step in that direction.
