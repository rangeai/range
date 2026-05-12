# Range — First-walkthrough scenarios

**Document type:** Working selection doc
**Status:** Draft for selection — pick one to develop further
**Date:** 2026-05-12
**Purpose:** Three candidate scenarios across three personas, each grounded in `ovrtx` (https://github.com/nvidia-omniverse/ovrtx). Each scenario demonstrates Range's value differently. Read all three, then pick one to anchor the first deep walkthrough.

---

## How to read this doc

For each persona, one scenario is described as a beat-by-beat narrative — what the developer says, what Range does, what evidence appears, where the work crosses team boundaries. The three are deliberately different in shape so the picking decision is meaningful.

After each scenario, three things:

- **Range moments** — the 2-3 places where Range's value is most visible
- **Without Range** — a short contrast for what the same work looks like today
- **What's still unclear** — open questions or assumptions that need pressure-testing

A short comparison section at the end names what each scenario uniquely demonstrates, to support the picking decision.

---

## The three personas

### Priya — ovrtx core developer at NVIDIA
Five years on the ovrtx team. Maintains the sensor-simulation side: lidar noise models, depth/semantic outputs, occasionally the denoiser. Codebase is C++ with Python bindings. Ships internally to Isaac Sim and externally as part of Omniverse. Her work is gated by visual correctness on golden scenes plus regression tests. Her hardest day is the customer bug she can't reproduce.

### Anika — Isaac Lab developer at NVIDIA
Builds and maintains Isaac Lab's sensor abstractions on top of Omniverse and ovrtx. Her code is the layer that robotics ML researchers consume — friendly Python APIs for cameras, lidar, depth, semantic outputs. When ovrtx changes, Anika is usually the first to find out from a Lab user reporting that something subtly broke. Her hardest day is the user-reported issue that crosses layers and turns out to be underneath her stack.

### Karthik — sensor-sim engineer at an AV company
His team licenses Omniverse and uses ovrtx directly (bypasses Isaac Lab) for low-level control over lidar and camera models matching their specific hardware. Owns a proprietary synthetic-data pipeline + an internal sim used to validate perception models. Doesn't have NVIDIA on speed-dial. His hardest day is when the perception team blames his sensor-model change for a real-world regression and he has to prove (or disprove) it without burning a week.

---

## Scenario A — Priya: the customer bug she can't reproduce

### Setup

It's Tuesday 10:30am. Priya is between meetings with 25 minutes. A new support ticket landed: a partner robotics company (call them **Roboto Inc.**) reports that `ovrtx 2025.4` produces incorrect lidar return intensities in their warehouse scene at >256 rays per beam. Attached: a USD scene file, a lidar config YAML, a sample output PNG showing the saturated returns, and an email transcript. They tested on H100; didn't try Ada. The ticket is high-priority because Roboto is a flagship partner; their release is gated on this.

Priya has no reproduction yet. She has the artifacts and a vague description.

### Walkthrough

1. Priya opens Range. The support inbox is wired into Range — incoming tickets with attachments are auto-staged as freeform sessions awaiting triage. The Roboto ticket appears on her home page under *In flight* labeled `freeform · roboto-lidar-intensity · just arrived`. She clicks in.

2. The session opens. Left panel shows: source = `support@`, repo = `ovrtx`, attached artifacts (USD scene preview, lidar config YAML, the sample output PNG with the saturated regions visibly clipped, the email transcript). No tracked Jira ticket yet. The session name is provisional.

3. Priya types: *"show me what we have, then start codex investigating in read-only mode against the lidar accumulator code path."*

4. Range expands the artifact previews inline: the USD scene thumbnail renders, the YAML shows lidar settings (1024 rays/beam, 60° FOV, on-vehicle pose), the output PNG is highlighted with a heatmap overlay showing where intensity values cap at 0.74.

5. Codex spawns in a read-only attempt. Streams its reasoning: *"Looking at `src/ovrtx/lidar/accumulator.cu`. The accumulation buffer uses a half-precision accumulator at line 142. Reading the kernel… for diffuse white surfaces sampled at 1024 rays, the per-sample contribution should accumulate to ~0.95 but the accumulator type can overflow silently above ~256 samples in this configuration."* This is hypothesis only; Codex hasn't run anything yet.

6. Priya: *"plausible. let's reproduce locally first before we trust the theory. spin up a runner and trace Roboto's lidar config on their scene."*

7. Range surfaces an approval gate: this is a GPU run, estimated 2 GPU-minutes on `rg-h100-7`, cost ~$0.30, dataset = Roboto's attached scene (already in the session under their NDA permission). Priya approves with one click.

8. The run streams into the evidence panel: log lines from the trace, the resulting intensity histogram (showing a sharp cliff at 0.74), and a heatmap of saturated pixels overlaid on the scene render. Within 90 seconds, the run finishes — bug reproduced. Same artifact, same numbers as Roboto reported.

9. Priya now has Roboto's bug locally with structured evidence. She says: *"okay, fix it in a new attempt — change the accumulator dtype to fp32 and add a regression test that catches this at 1024 rays."*

10. Range spawns `codex-fix-accumulator-dtype`. Codex makes the change (one line in the kernel, plus a CMake flag adjustment), adds a test in `tests/lidar/test_accumulator_overflow.py`, runs the test (passes), then re-runs Roboto's lidar trace. The intensity now reaches 0.94. No saturation.

11. Priya inspects the diff in the side panel. Looks minimal and right. She also wants to verify on Ada before shipping — accumulator behavior can differ across architectures. She says: *"also run this on an Ada runner."*

12. Range queues a second run on `rg-ada-2`. Streams the same evidence. Passes. Both arch verifications attached to the same attempt's verification record.

13. Priya hits *"open PR with evidence."* Range generates the PR: title, summary, the diff, the regression test, both run outputs (H100 + Ada) with their intensity heatmaps, link back to the support ticket, mention that Roboto's original artifacts are included as evidence with their consent.

14. Range also generates a draft customer-facing summary in a separate pane: *"We reproduced the bug on H100, identified an accumulator dtype overflow above 256 samples, fix is in PR #X, expected to land in 2025.4.1 next Tuesday. Verified on Ada as well. Patched scene render attached."* It's separable from the internal PR — the customer doesn't see Priya's diff or the regression test, just the result and the timeline.

15. Priya tweaks one sentence in the customer summary, sends it to Roboto. She approves the PR push.

16. Done in 22 minutes. The next meeting hasn't started yet.

### Range moments

- **Support inbox → freeform session auto-staging.** Priya didn't have to manually unpack the customer report; it was already a session with the artifacts in place when she opened Range.
- **Visual evidence streamed live.** The intensity histogram and saturation heatmap appear as the run produces them — Priya can judge whether the reproduction matches Roboto's report without leaving the conversation.
- **Cross-architecture verification in one flow.** H100 + Ada in the same attempt, neither requiring Priya to context-switch into a different tool.
- **Two-track output: internal PR + customer summary.** Same evidence, two audiences, no double work.

### Without Range

Priya manually downloads the USD scene and the lidar config from the support ticket, configures her workspace, builds her own reproduce command from scratch, runs it on her H100 dev box, opens the output in a separate viewer, debugs by hand, builds the fix, runs again, manually compiles a PR description, often forgets to test on Ada (skips it), writes a customer email separately in Outlook. Either takes 2-3 hours and skips proper Ada coverage, or takes most of a day with rigor. The customer waits two days longer for resolution.

### What's still unclear

- **Customer artifact access.** How does Range have permission to run Roboto's proprietary USD scene? Roboto agreed in this case via the ticket's attachment terms, but the permission model needs to be explicit.
- **Support-inbox ingestion.** Is the email → freeform-session auto-staging realistic, or does Priya have to drag the report in manually? If automatic, what's the trigger — keyword, attachment type, sender?
- **Customer-summary boundary.** What stays internal vs. customer-facing is sensitive. The mockup shows them as separable, but the policy is undefined: who decides what's internal-only?

---

## Scenario B — Anika: the user-reported issue that crosses layers

### Setup

Wednesday 2pm. An Isaac Lab user named **Marco** at TU Munich files a ticket against Isaac Lab: *"Depth-sensor returns are noticeably noisier in Lab 2.6 vs 2.5 for the warehouse_v3 example. My RL training is unstable since I upgraded."* Includes two screenshots (visibly noisier depth) and a 20-line repro script. The ticket lands in Anika's queue.

Anika's first instinct: probably something in her own depth-camera wrapper changed between Lab 2.5 and 2.6. But she's not sure, and she has 45 minutes before her next thing.

### Walkthrough

1. Anika opens Range. From her home page, *Assigned to you* lists `ISL-2287 · Depth-sensor noise in Lab 2.6 vs 2.5`. She clicks in.

2. Tracked-task session opens. Range has indexed Marco's screenshots and his repro script. Left panel shows task summary, suspected files (none yet), and a context pack drawn from the ticket body.

3. Anika types: *"reproduce on warehouse_v3, Lab 2.6 baseline first."*

4. Range creates `baseline-lab-2.6` attempt, checks out Lab 2.6, provisions a runner, executes Marco's repro script. Streams: depth output frames (visibly grainy), a depth-value histogram, log lines from the script.

5. Reproduces — the depth output is noticeably noisier than Marco's clean baseline screenshot. Confirmed.

6. Anika: *"now do the same on Lab 2.5."*

7. Range checks out the tagged Lab 2.5 commit in a second attempt, re-runs Marco's script. Streams same channels. The depth output is clean — matches the "before" screenshot. Confirmed regression: it's something between 2.5 and 2.6.

8. Anika expects her depth-camera wrapper is the culprit. She says: *"what changed in the depth sensor wrapper between 2.5 and 2.6?"*

9. Codex (in a read-only investigation attempt) runs `git diff v2.5..v2.6 -- src/sensors/depth_camera.py` and reports: *"Two changes. (1) a default parameter `max_distance` increased from 20m to 30m. (2) the ovrtx import pin moved from `2025.3` to `2025.4`. The wrapper logic itself is unchanged."*

10. Anika: *"hmm. test with the Lab 2.6 wrapper code but with ovrtx pinned to 2025.3."*

11. Range provisions a runner with a mixed-pinned environment: Lab 2.6's wrapper code, ovrtx forced to 2025.3. Re-runs the script. Streams evidence. Depth output is clean again.

12. So it's not Anika's wrapper. It's ovrtx 2025.4 that introduced the depth noise change. The wrapper parameter change is unrelated.

13. Anika: *"file this back to the ovrtx team with all the evidence, then write up Marco's ticket as upstream."*

14. Range opens the cross-team handoff flow. It drafts an `OVRTX` ticket pre-populated with: the symptom (depth noise regression), the bisect-style evidence (clean on 2.5, noisy on 2.6, clean again when ovrtx pinned back), Marco's repro script, all three runs' depth outputs and histograms, links back to the Lab ticket, the relevant depth-camera wrapper diff (already ruled out as the cause).

15. Anika reviews the draft. Adds a sentence in her own voice: *"likely affecting all Isaac Lab 2.6 users who upgraded; please prioritize before next Lab release."* Files it. Lands in the ovrtx team's queue as `OVRTX-1842`.

16. Range then helps her close out Marco's side. She comments on his ticket: *"Confirmed regression — caused by ovrtx 2025.4, not Lab. Filed as OVRTX-1842. Workaround: pin ovrtx to 2025.3 in your environment until fix lands."* The workaround command is generated from Range's reproduction config so Marco can paste it directly.

17. Range marks the Lab ticket as `upstream-pending`, links it to `OVRTX-1842` so the status propagates when the ovrtx team ships their fix.

18. Done in 32 minutes.

### Range moments

- **Bisect-style workflow driven conversationally.** Three runs (Lab 2.6, Lab 2.5, mixed) without Anika manually checking out repos or building environments.
- **The discovery moment.** Anika expected her wrapper was at fault. Range surfaced that it wasn't — and surfaced *what was* — without her having to dig manually.
- **Cross-team handoff with evidence.** The ticket filed to the ovrtx team carries everything they need: reproduction, bisect, ruled-out wrapper change, Marco's script. They don't have to ask Anika for context. The trust transfer is real.
- **Workaround communicated to the user with confidence.** Marco gets a concrete patch he can paste, not just a "we're looking into it."

### Without Range

Anika manually checks out Lab 2.5 in a separate clone, builds it, runs Marco's script, compares depth outputs by eye in a viewer, suspects her wrapper, manually diffs the wrapper code, debugs it, eventually realizes nothing's wrong with it, suspects ovrtx, checks the version bump, builds a mixed environment manually (requires unwinding the pinned dependency by hand), runs again, compares again, writes up the ovrtx ticket from scratch with screenshots she takes manually, and emails Marco a workaround.

3-5 hours of bouncing between terminal, VSCode, viewer, screenshot tool, Jira, Slack. Often she'd give up the bisect at step 4 and just file a vague "wrapper seems fine, might be ovrtx?" ticket — which the ovrtx team would bounce back asking for evidence.

### What's still unclear

- **Pinning an upstream dependency for a verification run.** How does Range produce a worktree that has Lab 2.6 source but ovrtx 2025.3? Conda environment? pip override? Submodule pin? The mechanics matter; this is a real engineering ask.
- **Cross-tracker filing.** "File it back to the ovrtx team" — does Range integrate with the ovrtx team's tracker (might be a different Jira project, or GitHub Issues for the public repo)? If so, how is the mapping configured?
- **Status propagation.** "Lab ticket marked upstream-pending and linked to OVRTX-1842" — does Range actually watch the linked ticket for status changes? Or just link it as text?

---

## Scenario C — Karthik: did my old sensor-model change break perception?

### Setup

Friday 3pm. Karthik shipped PR #341 to his company's internal sim repo two weeks ago: an improved lidar return intensity model for rainy conditions, validated against measured returns from their fleet. Today, the perception team's lead messaged him on Slack: *"Hey, our nightly model eval on real lidar shows a 3% mAP regression on rainy-day captures. Started showing up about a week ago. Your sensor-model change is suspect. Can you check before Monday?"*

Karthik's name is on PR #341. The perception team's release is gated on this. He either needs to fix it or prove it's not him before next week.

### Walkthrough

1. Karthik opens Range. From the home composer, he types: *"verify PR #341 against the perception team's rainy-day regression. I have eval-dataset access granted just for this."*

2. Range creates a verification session anchored to PR #341 (his own past PR). The diff, commit history, and the original PR's evidence package load into the session.

3. Karthik: *"first, what did I ship as evidence on this PR originally?"*

4. Range surfaces the original evidence: synthetic data samples at rainy-condition presets, an intensity-distribution chart compared against fleet-measured returns, a config change. Notably absent: any validation against the perception team's actual model. He didn't have access at the time.

5. Karthik: *"okay, now I have access. run my current sensor-model code against perception team's rainy-day eval dataset, and also run the pre-#341 code on the same dataset, then compare the perception model's mAP on synthetic data generated by each."*

6. This is a heavy ask. Range plans the work: provision an internal cluster runner with eval-dataset access (permissions check passes; Karthik's grant is active), create two attempts — one at HEAD, one at the pre-#341 commit — generate synthetic data with each version on a matched subset of the eval set, run the perception model evaluation on both synthetic datasets, then compare against the real-data baseline. Estimated total: ~40 minutes on the cluster, cost ~$14.

7. Karthik approves the run. He goes to make tea.

8. While the run is queued, Range surfaces an interesting parallel in a "context" panel: it noticed the perception team also has internal pipeline changes from last Tuesday (visible via the company's shared CI history). It flags this as: *"the perception team's training pipeline had three commits last Tuesday — these are an alternate hypothesis for the regression."*

9. The run completes. Results stream into a comparison view:

   - **Pre-#341 sensor model:** synthetic data matches measured rain intensity less well numerically. Perception model mAP on syn-eval: 81.4%.
   - **Post-#341 sensor model:** synthetic data matches measured rain intensity better. Perception model mAP on syn-eval: 81.7%.
   - **Delta:** +0.3 percentage points under Karthik's change, not −3.

10. Range surfaces the headline: *"Your sensor-model change is not the cause of the perception regression. Under both syn-to-real conditions, model performance is slightly higher with #341 than without."*

11. Karthik exhales. He spends two minutes scrubbing through the side-by-side intensity histograms and the per-class mAP breakdown — nothing surprising, the result holds across object classes.

12. Karthik: *"what about the perception team's pipeline changes from last Tuesday? can we surface them as a suggested next step?"*

13. Range pulls the three commits from the perception team's pipeline repo and flags them as candidate hypotheses. He can't run their pipeline himself — different team, different repo — but he can share findings with them.

14. Karthik: *"share my verification record with the perception team's lead and suggest they look at their pipeline changes from last Tuesday."*

15. Range generates a shareable view: the verification record (pre-#341 vs post-#341 results, both better than the regression suggests his change is the cause), the relevant evidence, plus the three perception-team commits as a flagged "alternate hypothesis." Karthik tweaks the message to be politely-but-clearly: *"strong evidence this isn't #341 — suggest looking at your training pipeline changes from 5/7."*

16. He sends it. End of his thread for the day.

17. Done in about 50 minutes (40 of which was Range running the eval, during which he made tea, answered other Slack threads, and reviewed a teammate's PR).

### Range moments

- **Self-verification using his own PR's original evidence.** Range pulled what he shipped, re-ran the same logic against new data he didn't have at the time. Most tools force a manual rebuild.
- **Multi-version comparison with structured output.** Pre-#341 and post-#341 results, compared on a real-world metric (perception model mAP), not just a sensor-model numerical metric. The "passes the metric but looks wrong" pattern, inverted.
- **Polite, evidence-backed cross-team pushback.** Karthik doesn't have to argue with the perception team in Slack. He sends them a shareable verification record. The conversation becomes about the next hypothesis, not about blame.
- **Cost transparency upfront.** $14 of cluster time was approved knowingly. Without that, the run would either not happen ("too expensive to investigate") or happen invisibly and bite him at billing time.

### Without Range

Karthik would have to (1) manually check out the pre-#341 commit, build it in parallel with HEAD, (2) generate synth data with both versions across a matched eval subset, (3) get the perception team's eval pipeline running (or ask them to run it, with the round-trip cost), (4) compare results in a spreadsheet, (5) write up the findings, (6) push back via Slack with hand-built charts.

Realistic outcome: 1-2 days. Or, more likely, he'd accept blame, "fix" something in his sensor model unnecessarily, and the real cause (perception team's pipeline change) wouldn't be found for another two weeks until it surfaces somewhere else. The cost isn't just Karthik's time — it's the false fix shipping forward.

### What's still unclear

- **Cross-team dataset permissions.** "Eval-dataset access granted just for this" is plausible at a company that does this kind of grant — but the model needs to handle scoped, time-bound permissions. Today most ML orgs do this via shared S3 buckets and Slack DMs.
- **Cross-repo CI awareness.** The "context panel surfacing the perception team's last Tuesday commits" assumes Range can see other teams' CI activity. That's a permissions + integration story that needs to be designed.
- **Shareable verification records.** What does the perception team see when Karthik shares his record? Read-only embed? A dashboard URL? A markdown export? Each has different security implications.
- **Cost approval at this scale.** $14 is low. At $1400, the approval flow probably needs more than a single click — at minimum a budget envelope per session.

---

## Comparison — what each scenario uniquely demonstrates

| | Priya | Anika | Karthik |
|---|---|---|---|
| **Wedge demonstrated** | Range turns incomplete customer reports into reproducible, evidence-backed fixes — and packages the result for both internal review and customer-facing communication | Range makes cross-layer debugging tractable; the answer often isn't where the developer expected, and the cross-team handoff carries real evidence | Range lets you prove (or disprove) cross-team accusations with evidence, not vibes — and surfaces alternate hypotheses you wouldn't have thought of |
| **Primary entry mode** | Freeform session, auto-staged from support inbox | Tracked task, GitHub/Jira originated | PR verification on the user's own past PR |
| **Range capabilities exercised** | Artifact ingestion · cross-arch verification · visual evidence streaming · two-track output (PR + customer) | Bisect-style multi-run · cross-layer investigation · cross-team handoff with evidence · upstream-pending status linking | Self-verification · multi-version comparison · cross-team evidence sharing · alternate-hypothesis surfacing · cost budgeting |
| **Demo power** | Visceral. Visual evidence + customer-facing outcome = strong "wow." | Subtle. The discovery moment lands hard for people who've been in that situation. Cross-team handoff is the moat moment. | Strategic. Most relatable for ML/AV people. Pushes back on the question "is Range just a fancy chat?" by showing structured cross-team evidence flow. |
| **Demo risk** | Sensor-sim is niche. Audiences outside Omniverse may not feel the pain immediately. | Requires explaining two layers (ovrtx + Isaac Lab). Adds setup cost in a presentation. | The training-eval angle stresses Range's metric-heavy verification (where the spec is weakest today, per the earlier stress test). |
| **Hardest open question** | Customer artifact permissions / NDA boundary | Cross-tracker filing mechanics | Cross-team dataset and CI permissions |

## My read

If the goal is the most **visceral first demo**, pick **Priya**. The visual evidence is undeniable, the customer-facing outcome is concrete, and the entire arc fits in 22 in-product minutes. It also showcases Range's strongest, most spec-aligned capability (the simulation streaming and visual evidence layer).

If the goal is the most **moat-defining story**, pick **Anika**. The cross-team handoff with real evidence — Range becoming the substrate that carries trust across team boundaries — is the thing no incumbent tool does. The discovery moment ("it wasn't your wrapper, it was the layer underneath") is also the kind of beat that sticks in a viewer's memory.

If the goal is the **most relatable to ML/AV audiences**, pick **Karthik**. The evidence-backed pushback against a cross-team blame is a universally felt pain in ML work. This scenario also stress-tests Range's training/eval angle and would surface AC gaps we noted earlier (multi-seed semantics, distributional metrics).

I'd lean Priya for first walkthrough, Anika second, Karthik third — but all three are legitimately strong. Tell me which to develop further.
