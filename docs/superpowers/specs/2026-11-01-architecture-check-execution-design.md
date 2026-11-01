# Architecture check execution partition

## Goal and scope

Finish the existing P6 prerequisite Architecture gate with its complete canonical selection, within bounded CI jobs. This is a verification execution change, not a product, data, test-selection, or acceptance change. The user authorized all remaining preflight work; the execution partition below is the implementer's choice within that scope. P6-3 remains out of scope.

The existing runner executes prerequisites, command groups, all unit batches, and then every selected browser spec in one 45-minute job. In run 41291125871 the browser started about 17 minutes into the job with 466 cases selected and one worker. Only 23 results were emitted before superseding work cancelled it. Successful cases in this prefix alone averaged about 6.8 seconds; that sample does not establish a total duration, but it does not support expecting all 466 cases to fit the remaining 28 minutes.

## Approaches

- Increase the single job timeout: the smallest YAML change, but retains serial browser execution and delays failure evidence. A longer timeout alone does not establish a completion budget.
- Split browser execution across isolated CI runners: retain one browser worker per runner, the same source/data identity, and the complete selected list. This adds a small execution interface and a final aggregation gate while avoiding repeated unit/native work.

Use the second approach, initially at most eight browser shards. The subsequent run 41293171601 reached its job limit after about 30 browser minutes with 50 of 466 results (25 passed, 25 failed), leaving 416 cases without results; four shards do not have a demonstrated completion budget. Eight keeps the execution footprint bounded and still requires actual CI completion evidence. Retain the current 45-minute limit for each job. Do not change test timeouts, retry policy, assertions, or the manual list to make the gate pass.

## Design

Keep `planApplicationChecks` and all ownership/selection rules unchanged. Extend the canonical runner with explicit execution phases: the default continues to execute everything, a non-browser phase executes the selected prerequisites/command groups/unit batches once, and a browser phase executes the existing browser prerequisites plus the entire selected browser spec list with Playwright's supported `--shard current/total` argument. Each browser process retains `--workers=1`. Validate phase and shard arguments and fail on malformed or incompatible values.

The Architecture workflow uses one canonical selection and a bounded nonempty browser matrix. Command groups, native consumers, and unit batches run once in their own job. Browser shards run on separate runners with `fail-fast: false`, so one failure cannot erase another shard's result. The existing `checks` gate aggregates the selection, non-browser, and browser results and fails if any required phase fails, is cancelled, or cannot execute. A phase may be skipped only when its selected scope is empty. Preserve the existing explicitly requested diagnostic jobs and their conditions.

Emit phase/shard metadata with evidence so a partial shard cannot be presented as a full gate. Upload each phase's result under a distinct artifact name; retain browser failure traces/screenshots already produced by Playwright. Keep exact code/data identity and the complete selected spec list reviewable. The 31 manual specs, including the two explicitly deferred timeline cases, stay excluded by the unchanged canonical plan.

## Verification and review

Add focused behavioral regressions to the existing application-check runner tests. Demonstrate that default execution is unchanged, non-browser and browser phases preserve their selected work, browser shards receive the same complete spec list and valid distinct shard arguments, invalid execution options fail, prerequisite failure remains blocking, and aggregate status cannot accept a failed/cancelled required phase. Validate the workflow structure and its matrix/gate conditions. Review the exact staged diff independently before publication.

Do not claim runtime success from mocked runner tests or a planned matrix. After publication, require the actual non-browser result and every selected browser shard to complete successfully before treating Architecture as passed. The public Viewer remains a separate final gate after the already authorized main integration.
