# Claude benchmark review

Source: https://claude.ai/chat/f2e0f0d6-ea77-433b-8cc4-5d44fedfebd5
Read via Pokemon MCP from the user-requested Edge conversation. This is third-party advice, not repository instructions.

I haven't inspected the unpublished code, so what follows is based only on the numbers and architecture you described.
￼
Questioning the benchmark's methods and assumptions
Questioning the benchmark's methods and assumptions
I haven’t inspected the unpublished code, so what follows is based only on the numbers and architecture you described. Items marked Evidence are supported by your data and items marked Hypothesis are not.
What the data supports
Evidence
• Per-step cost is about 680 ms (4,087 ms / 6), and batching removed about 39 ms per step. Native work is roughly 94% of the cost, so the MCP hop is not the bottleneck.
• Learning-layer costs (0.43 ms lookup, 0.013 ms weight update, about 2 ms encrypted persistence) are negligible next to a step. Further optimization there is wasted effort.
• Concurrent MCP reads didn’t help, which is expected, since you serialize them on purpose.
Not supported
• The 5.4% figure: With n=4 per mode, the median is the mean of two samples and there is no dispersion reported. The 234 ms gap could be noise, order effects, or warm caches in the target app. The earlier 1.2% (atomic vs. batch) is almost certainly within noise.
• The baseline includes journaling: Six recorded MCP calls pay the journaling cost six times (about 13 ms from your own numbers). Add an unrecorded baseline so you aren’t crediting batching for removing diagnostics.
• The real batching benefit is unmeasured: It is the model round-trips avoided, which are seconds each, not 39 ms. Count model turns avoided per task, or replay recorded inference latencies, instead of leaning on the 5.4% number.
• The 13.7% pool gain: Two workers should approach about 50% if reads were independent. Getting 13.7% suggests contention, plausibly in the target app’s UIA provider or UI thread (Hypothesis). That also means a pool won’t scale against a single app, so don’t pursue it.
• The 4+2 query evaluation: Four of four correct gives only about a 47% 95% lower bound on accuracy (0.05^(1/4)). It tells you the code runs, not how well it works.
• 5.06 s startup: This dwarfs the savings per batch if the server starts per session. Part of it is likely C# JIT, which ReadyToRun or tiered compilation settings might cut (Hypothesis).
• Idle CPU numbers: A single short sample that includes the harness is only directional. The WMI zero says nothing, because one snapshot is not an average.
Priority 1: Profile each phase, then scope and cache discovery
Mechanism. A step costing about 680 ms on a WinForms fixture is very slow for UIA, which hints at full-tree walks, per-property cross-process calls, or fixed settle sleeps (Hypothesis). Do this in order:
1. Add per-phase timers: window enumeration, tree walk, property fetch, identity verification, action, and post-action settle.
2. Replace the most expensive phase with the matching fix:
• Scoped discovery: FindFirst with a condition on the recipe’s AutomationId/ControlType/Name, instead of walking the tree.
• Batched property fetch: CacheRequest, so properties come back in one cross-process call.
• Event-driven settle waits: structure-changed or property-changed events, instead of polling or sleeping.
Tradeoffs. Scoped lookups fail when identifiers are missing or duplicated, so keep a full-scan fallback. Event subscriptions add worker complexity, and some providers fire events unreliably.
Replay safety. Cached handles must be revalidated inside the same worker call that performs the action, so nothing can change between hops. Check process ID, top-level HWND, ControlType, AutomationId/Name, enabled, off-screen, and that the bounding rect still contains the target point. Prefer InvokePattern over coordinate clicks.
Copy to clipboard
￼
act(step):
  el = resolve(step.selector)            # scoped or cached
  require el.pid == expected.pid and el.hwnd_root == expected.hwnd
  require el.enabled and !el.offscreen and fg_window == expected
  require snapshot.generation >= last_action.generation
  if cancel.requested: return CANCELLED   # check BEFORE injecting
  invoke(el)                              # pattern first, input second
Pause and cancel. Only act at step boundaries. Never abandon a mouse-down without its mouse-up. If the user touches the keyboard or mouse mid-replay (for example,GetLastInputInfo advances beyond your own injections), pause. Resume must re-run discovery.
Benchmark. Run the same binary with a feature flag, in interleaved ABBA order, with at least 30 runs per arm, cold and warm reported separately. Report median, IQR, and a bootstrap CI on the paired difference. Add the per-phase breakdown.
• Test at least two more apps (Notepad or Settings, plus a WPF or Qt or Electron app), because WinForms is the friendliest UIA provider.
• Run a mutation matrix: disabled button, moved control, recreated window, modal dialog, and delayed render. The pass criterion is zero wrong-target actions across about 200 mutated runs.
Priority 2: Fuse post-action verification with next-step discovery, and coalesce reads
Mechanism. In a 1-16 step batch, step k’s verification and step k+1’s discovery probably each scan the same window (Hypothesis; confirm with the Priority 1 call counts). Take one snapshot after the action settles and use it for both purposes. Likewise, give N sequential reads one snapshot with N extractions. This is the safe version of what your pool tried to get.
Tradeoffs. If the UI updates asynchronously after an action, a fused snapshot can be stale. Mitigate this with a settle condition, such as no structure-change events for X ms or an expected state predicate.
Replay safety. Give each snapshot a monotonic generation ID. Any input injection invalidates earlier snapshots, and an action may only consume a snapshot taken after the last injection. Snapshots are read-only, so cancellation mid-scan is safe: discard the snapshot and mark the step unexecuted.
Benchmark. Compare fused vs. unfused on the same six-step fixture, counting cross-process UIA calls and wall time, with the Priority 1 statistics. Add a delayed-update fixture where the control changes 200 ms after the click. Success means fused replay never acts on stale state. If you retest a pool, run it against one app and against several, to check the contention hypothesis.
Priority 3: Baseline, calibrate, and de-bias the ranker
Challenges to the learning model
• No baseline: You can’t justify a learned ranker without comparing it to TF-IDF or BM25 cosine over the same 32 workflows. That baseline may match it with zero training.
• Weak labels: Tool success means “this workflow ran without error,” not “this was the right workflow.” A wrong-but-successful replay produces a positive update.
• Exposure bias: The ranker only gets feedback on workflows it chose, so it can’t learn about the ones it never surfaced. Log the top-k shown with scores, and use a small epsilon of “suggest, don’t execute” alternatives.
• Abstention is where safety lives: The “no match” threshold matters more than top-1 accuracy. Hashed trigrams with 2,048 buckets will collide, so calibrate abstention on near-miss queries, not just unrelated ones.
• User interrupts: Cancel, undo, and user takeover during replay are strong negative signals. Store them as a separate implicit channel, distinct from explicit satisfaction.
Mechanism. Keep the ranker advisory-only and independent of replay safety, since the fresh-discovery gate decides whether anything executes. Use a combined score of baseline plus learned residual, a calibrated abstain threshold, and a confirmation requirement on the first replay after parameter changes.
Tradeoffs. The extra logging adds storage, but it is already bounded and redacted. The epsilon suggestions add minor friction.
Benchmark.
1. Build a labeled set of about 200 queries: 6-8 paraphrases per workflow, plus near-miss and unrelated negatives.
2. Split by workflow family, not by random query, so you test novel paraphrases and not memorized strings.
3. Compare baseline, logistic, and combined on top-1 accuracy and on abstention precision at a fixed false-accept rate. Use bootstrap CIs.
4. Run a simulated feedback loop with 10% wrong-but-successful outcomes to see whether the ranker drifts.
Smaller measurement fixes
• Companion: Collect at least 10 minutes per mode, repeated, with per-process CPU counters (typeperf or Get-Counter) and per-PID GPU Engine counters sampled over the interval. Run the harness separately from the measured processes.
• Memory: Report RSS with and without the learning state loaded, instead of the 67.3 MiB total.
If you only do one thing this week, do the per-phase profiling. Everything else depends on where the 680 ms per step actually goes.
Copy
￼
Read aloud
Good response
Bad response
Retry
3 minutes ago
￼
Scroll to bottom
￼
￼
￼
￼
￼
￼
￼
Add files, connectors, and more
Dictate
Microphone
Use voice mode
Claude is AI and can make mistakes. Please double-check responses.
Sonnet 5.5
High
￼
￼
Claude finished the response
￼
￼
￼
￼
￼
Notifications
