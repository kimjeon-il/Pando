# Map transition P0: read-only baseline

Approved scope: record present results, transition time, resource observations and essential regression contracts. No loading presentation, renderer behaviour, Core ownership, runtime data, pinned data revision or native app code changes.

## Implementation and checks

1. `tests/helpers/map-transition-baseline.mjs`: lossless semantic comparison, strict latency statistics, exact-anchor test-only observation. Unit tests cover changed coordinates, geometry versions, names, flags, colours, parents, existence, missing data and invalid timings.
2. `tests/unit/map-transition-clock-contract.test.mjs`: real builtin clock, presentation-commit once, reverse completion, failure retention, stale failure, A/B/A and suspend after file-open.
3. `tests/browser/map-transition-baseline.benchmark.mjs`: unchanged application observed through Playwright response routing. It records renderer presentation and application/search-ready separately. Existing timeline tests remain in the workflow. No production instrumentation or monkey-patching of fetch/Worker/GPU methods.
4. `tests/browser/map-transition-baseline.config.mjs`: opt-in benchmark, no retries or performance pass threshold. The .benchmark file is not selected by default Playwright testMatch.

Run focused helper tests with `node --test tests/unit/map-transition-baseline.test.mjs`. Prepare branch-pinned dependencies through the existing repository procedure, then run the workflow's exact commands. Benchmark command: `pnpm exec playwright test --config tests/browser/map-transition-baseline.config.mjs`.

## Definitions and limitations

Input latency starts at a captured DOM input event, ends at the existing temporal `onPresented` callback, and is not a claim of physical hardware scanout. Application/search-ready is recorded separately. Source preparation markers are elapsed intervals including queueing, not pure CPU costs; nested intervals must not be summed as disjoint work.

The benchmark preserves all source checks and snapshot semantics. Route injection must match exactly one current source anchor or fail. Routing disables browser HTTP caching; first visits and same-page repeat visits are named honestly, not called verified cache hits. The fixed clock is 2026-10-31 in Asia/Seoul. Current year uses the existing current-month rule; other year controls use existing year-end semantics.

The desktop and narrow-viewport runs use the same CI machine. The latter is not a real mobile hardware benchmark. Raw renderer stats, CDP JS heap/DOM, active page Worker count and resource/long-task entries are included. Missing metrics stay null. JS heap is not total process, Core/WASM or GPU memory. Semantic snapshots are lossless, written outside measured intervals; their allocations may affect later GC. No forced GC is performed.

Each report records code SHA, paired data pin, build metadata, original observed module hashes, environment, samples and failures. It records 20 repeated adjacent transitions per viewport plus first/revisit scenarios; p95 uses nearest rank. One run does not establish absence of leaks. The startup ready-poll observation is explicitly not first-map frame latency.

## Completion gate

P0 is complete only after the actual runtime, existing regression tests, and benchmark execute successfully, and unique evidence is archived through the canonical library report procedure. Helper-only tests, created workflows, pushed commits or pending Actions are not a completed baseline. Do not invent latency numbers when a runtime prerequisite or benchmark fails. No main merge or deployment is authorized.

Store verified evidence under `reports/development/performance/map-transition-p0/<run>/`, using `tools/report-paths.mjs` and the normal `--publish-reports` / `--check-reports` commands. GitHub Actions artifacts are temporary test outputs, not permanent library report publication.
