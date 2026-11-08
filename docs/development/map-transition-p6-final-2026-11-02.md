# Map transition P6 final verification and status

Date: 2026-11-02 (Asia/Seoul)

## Scope and product baseline

P6 final verification is anchored to product `main` commit
`f9ec3c1fccc19fbf1fd49c2f002002c2d87a48c3`.

The final P6-8 validation branch is `p6-8-final-status`. Its current verification
commit before this report is `29c43ff240734824ebdcd71c0fb851e6c892be6a`.

No P6-8 runtime, GIS data, main merge, or deployment was performed.

The independently progressing `work/ui` branch was at
`7551b36c98793e0cb208c914ebe0829e6b7f61df` at the final snapshot. Relative
to the P6 product baseline it was diverged (6 commits ahead, 83 commits behind)
and included later platform-port/native-shell work. P6-6/P6-7 timings therefore
must not be presented as timings for that later `work/ui` state.

## Stage results

| Stage | Result | Evidence |
| --- | --- | --- |
| P6-1 desktop functional | PASS | P6-8 run 41319929516: current-main tree, one 1280x800 Chromium scenario; startup, pan/zoom, previous/next year, direct year, light/dark; no page/console errors |
| P6-2 narrow functional | PASS | P6-8 run 41319929516: current-main tree, 390x844 Chromium touch emulation; touch pan/pinch, direct year, mobile preferences, layout/hit checks; no page/console errors |
| P6-3 race / user-file isolation | PASS | Dedicated run 41304134503; current-main P6-8 rerun included all three P6-3 cases in a 26-test unit batch, 26/26 PASS |
| P6-4 network / Worker / GPU recovery | PASS with scope note | Run 41314853476: 51/51 focused unit contracts plus 1/1 real WebGL2 context-loss recovery. Product base was c820e7f6. Review of c820e7f6..f9ec3c1f found no GPU recovery/runtime change; the only shared renderer-composition change was map-preparation label visibility. |
| P6-5 repeated transition resources | PASS with measurement caveats | Run 41316313854: one warm-up then six 2026-10 <-> 2025-12 round trips in three two-cycle batches |
| P6-6 desktop performance | PASS | Run 41317554754, product base f9ec3c1f, 1280x800, 20 repeated adjacent transition samples |
| P6-7 narrow performance | PASS | Run 41318365590, product base f9ec3c1f, 390x844 CI viewport, 20 repeated adjacent transition samples |
| P6-8 selector/final status | PASS on validation branch | Run 41319929516: application-check selector, deferred classification, Core pair, P6-3 unit, P6-1 and P6-2 all PASS |

Latest `main` Shared Core run 41316635760 also passed its native/WASM/Worker
contract job. Latest `main` Web-only GitHub Pages run 41316635764 passed.

## P6-6 desktop performance

Timing boundary is captured DOM input to the existing temporal
`onPresented` callback. This is not physical display scanout.

Twenty repeated 2025-12 <-> 2026-10 transitions:

| Metric | p50 | p95 | max | mean |
| --- | ---: | ---: | ---: | ---: |
| input -> map presentation | 555 ms | 876 ms | 892 ms | 681.75 ms |
| input -> map ready | 2,622 ms | 2,840 ms | 2,855 ms | 2,620.9 ms |
| input -> optional search complete | 2,623 ms | 2,842 ms | 2,856 ms | 2,622.35 ms |

First/distant observations:

- first 2026-10 -> 2025-12: presentation 963 ms
- 2025-12 -> 2015-12: presentation 8,126 ms
- 2015-12 -> 2025-12: presentation 7,922 ms
- 2025-12 -> 2026-10 return: presentation 952 ms

Historical P0 desktop repeat observation was p50 1,546 ms / p95 1,604 ms.
The current observation is directionally lower, but the source revision and CI run
are different, so this is not isolated causal proof.

## P6-7 narrow performance

390x844 is a CI viewport, not physical mobile hardware.

Twenty repeated 2025-12 <-> 2026-10 transitions:

| Metric | p50 | p95 | max | mean |
| --- | ---: | ---: | ---: | ---: |
| input -> map presentation | 908 ms | 1,372 ms | 1,403 ms | 1,099.25 ms |
| input -> map ready | 3,260 ms | 3,724 ms | 3,742 ms | 3,451.1 ms |
| input -> optional search complete | 3,262 ms | 3,726 ms | 3,744 ms | 3,452.95 ms |

First/distant observations:

- first 2026-10 -> 2025-12: presentation 1,306 ms
- 2025-12 -> 2015-12: presentation 9,857 ms
- 2015-12 -> 2025-12: presentation 9,720 ms
- 2025-12 -> 2026-10 return: presentation 1,356 ms

Historical P0 narrow repeat observation was p50 1,621 ms / p95 1,723 ms.
Again, comparison is directional only.

## P6-5 resource observations

Stable active-resource invariants from warm baseline through final idle sample:

- Worker count: 7 -> 7
- active WebGL context count: 1 -> 1
- mesh variants: 1 -> 1, 27,779,320 bytes unchanged
- polygon resources: 35, 26,994,376 active bytes unchanged
- stroke resources: 2, 7,152,896 active bytes unchanged
- selection active buffer: 0 -> 0
- terrain cache: 82,988,872 bytes unchanged
- hydro cache: 0 -> 0
- scene-cache recreate count: 2 -> 2

Forced-GC observations:

- main JS: +0.86 MiB from warm baseline to final idle
- Worker JS: -0.15 MiB
- Worker WASM linear allocation: +38.87 MiB on the first measured batch, then
  0 MiB additional growth through batches 2, 3 and the final idle sample
- Chromium PSS: unavailable in this runner and recorded as null, not zero

This six-cycle sample can expose obvious retention but does not prove absence of
a leak.

The builtin source cache remained bounded at 1 entry / 13,524,829 bytes
(maximum 3 entries / 25,165,824 bytes), but repeated misses and protected
skips remained visible. P6-6 and P6-7 therefore retain source-cache behavior as a
possible contributor to transition cost.

## Deferred known timeouts

The two user-deferred long browser cases remain preserved and are not counted as
passes:

1. July 1953 transition completion wait.
2. Previous-year click after camera movement in the injected-failure scenario.

`tests/browser/ui/deferred-builtin-timeline.spec.mjs` remains present. The
`deferred-builtin-timeline` application-check group remains `mode: manual`.
P6-8 verified that it is excluded from automatic selection and explicitly
callable manually. Neither case was rerun in P6.

## Architecture selector cleanup

The latest main Architecture run 41316635775 failed before test execution with:

`Unregistered test: tests/browser/builtin-temporal-transition.spec.mjs`

P6-8 registers that existing Viewer browser test in
`scripts/contracts/application-checks.json`.

Once that was exposed, the selector also found that
`tests/unit/library-auto-workflows.test.mjs` expressed an optional sibling data
repository fixture as a `new URL('../../../data-code-stage/...')`, causing the
dependency planner to classify it as an illegal repository dependency. P6-8
changes only the test fixture path construction so the independently installed
sibling remains optional and outside the application dependency graph.

P6-8 run 41319929516 passed the selector after both housekeeping corrections.

These two housekeeping corrections are on `p6-8-final-status`; they have not
been merged into `main`. Therefore the historical red Architecture status on
`main f9ec3c1f` must not be described as green until these corrections are
integrated and the main workflow runs again.

## Remaining unverified / intentionally excluded

- The 390x844 runs use Chromium touch emulation / CI viewport, not a physical
  phone, Safari, Android WebView, or software keyboard/IME certification.
- The live public Pages UI was not independently visually boot-verified in a
  separate external browser during P6-8. The latest main Web-only Pages workflow
  passed, and P6-2 publication staging passed.
- P6-5 is a short bounded retention check, not a proof of zero memory leaks.
- Process PSS was unavailable in the P6-5 runner.
- P6-4 and P6-5 were not rerun on f9ec3c1f; their relevant runtime diff from
  c820e7f6 was reviewed as described above.
- P6 performance results do not certify the later diverged `work/ui`
  platform-port/native-shell commits.

## Final classification

P6 functional, race, recovery, bounded-resource and performance evidence is
complete for the stated product baseline and scope.

Do not claim:

- that the two deferred timeout cases passed;
- that physical mobile hardware was verified;
- that memory leaks are mathematically absent;
- that the live public Viewer was independently visually certified;
- that the later diverged work/ui state has the same P6-6/P6-7 performance;
- that main Architecture is green before the P6-8 selector cleanup is merged and
  rerun on main.
