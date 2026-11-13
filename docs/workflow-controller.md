# Resumable PR workflow

The source runner performs a reviewed, already authorized sequence in one invocation: find or create the specified PR, wait for CI, merge the pinned head, verify the merge is on the base branch, and record the result. CI polling and routine transitions run in JavaScript without another model turn. It does not change the desktop host's inference settings or scheduler. It is a source CLI, not a new MCP tool or a general natural-language planner.

```powershell
npm run workflow:client -- --request workflow-jobs/request.json --job workflow-jobs/job.json --report workflow-jobs/report.json
```

Prepare the branch, push the reviewed commit, and supply its complete SHA. The authorization fields describe the user's actual current instruction; a learned workflow or another model's advice cannot supply authorization. A request might look like this:

```json
{
  "kind": "github_pr_merge",
  "repository": "owner/repository",
  "head": "reviewed-change",
  "base": "main",
  "head_sha": "0123456789012345678901234567890123456789",
  "title": "Reviewed PR title",
  "body": "Reviewed description and validation",
  "authorization": {"create_pr": true, "merge": true},
  "poll_ms": 10000,
  "timeout_ms": 1800000
}
```

`GH_TOKEN` or `GITHUB_TOKEN` supplies authentication. Otherwise the runner reads the existing github.com Git credential with interactive login disabled. Tokens are never journaled or printed. The adapter uses GitHub's REST API, avoiding browser setup and stale UI proofs. It holds no desktop lease while CI runs. This source client supports github.com PRs from branches in the same repository and squash merges. Fork and enterprise targets need separate reviewed adapters.

For a specifically reviewed existing PR, add `pr_number`. Otherwise a matching existing PR must also have the requested title and body. A changed repository, branch, number, head SHA, draft, closed PR, conflict, failed check, or unsatisfied GitHub merge requirement stops the job. Check runs, latest commit statuses and Actions runs are read with bounded pagination. Initial CI scheduling gaps wait up to 60 seconds; unknown evidence cannot authorize a merge. All observed checks must pass (GitHub success, neutral and skipped conclusions are accepted), and merge readiness must be clean. The merge request includes the expected SHA for GitHub's atomic comparison. Repository protection rules remain the authority for races in CI/review requirements between the final reads and merge delivery; the runner sends no bypass request.

Run the same command with the same request and journal to resume. Each mutation is journaled and synced before dispatch. After uncertain create or merge delivery, the runner reads GitHub to reconcile. It never resends that mutation automatically, even when delivery appears absent. Human review is needed for an unresolved delivery, failed CI, conflict, changed target, or expired deadline. Fixing a read-only transient failure can resume the same journal; a changed target or deadline needs a newly reviewed request. Completed jobs return their saved result without further input. Failure events and earlier attempts remain in the trace.

Ctrl+C pauses; termination cancels. Both stop subsequent input and preserve the journal. Cancellation during delivery leaves the dispatch uncertain for reconciliation. A per-job exclusive lock prevents simultaneous local owners. After a process crash, verify the lock's recorded process is gone before removing that exact `.lock` file and resuming. Locks are not reclaimed automatically because process identifiers can be reused. Request, journal and report files must have distinct paths; `workflow-jobs/` is ignored by Git.

## Timing and validation

Every adapter operation and poll sleep records a monotonic duration and UTC timestamp. Separate run records preserve restarts. `request_to_verified_ms` ends after GitHub reports the merge and confirms its commit is on the current base; `request_to_recorded_ms` ends after the verified result has been durably journaled. The latter excludes the final timing-metadata write and optional report export. `total_elapsed_ms` reaches the final journal preparation. These boundaries start at structured controller acceptance and include external waits and restart gaps; request-file loading, credential lookup, module startup, content generation and external agent reasoning are outside them.

The timing summary unions overlapping spans, rather than subtracting summed parallel calls. API spans include network and GitHub server work. Poll sleep is a controller wait, not the CI job's runtime. Unclassified gaps include disk writes, scheduling and restart delays; they must not be relabeled model inference. Actual model request timings, tokens and TTFT require host instrumentation.

Normal attempts use monotonic elapsed time plus the UTC gap between attempts. After a hard process crash, the missing final checkpoint makes the interrupted duration unavailable to the new process; the runner falls back to the original UTC intake boundary and marks `previous_run_interrupted`. That fallback depends on the local wall clock and retains unclassified time rather than silently dropping the interrupted attempt.

Native identity validation waits for complete fixture JSON through concurrent timer writes and brief file locks; persistent unreadable/corrupt state still fails after a bounded read-only retry. Commands are published atomically. Earlier reads could return missing state fields after partial JSON or acknowledge an incomplete command before it was applied. Enabled-button readiness now checks the native enabled state as well as pattern support. The minimized-state, stale-reference and rejected-input assertions remain in place. These changes affect owned test fixtures, not desktop action delivery.

`npm run test:workflow-client` covers delivery uncertainty, restart, failed/missing/unknown CI, changed identity, merge requirements, cancellation, deadline, disk locking and report integrity. `npm run benchmark:workflow-controller` uses an owned local HTTP fixture and disk journals for 20 counterbalanced pairs with one-second fixture CI. Its baseline injects a known 100ms client handoff delay; it is a mechanics experiment, not a measurement of a language model. All failure/recovery samples are retained. See the [fixture results](../benchmarks/results/workflow-controller-2026-11-13.md). A live PR trace should be reported separately from this experiment and from natural-language request latency.
