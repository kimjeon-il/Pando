# P6–P9 execution ledger and approved implementation contract

Baseline: `8e22982616e3c9ba43eeb84baec17cd886267cfa`, permanent `work/objects`.

The approved conversation plan is the specification. Implement in this order:

- [ ] P6: port polygon-clipping 0.15.7 behavior to shared C++; wire native and WASM; port cut/river calculations; port reference image calculations; retire product QJSEngine scripts and required Node build/test dependencies. Preserve current formats, cancellation, atomicity and Undo/Redo.
- [x] P7: extend the existing P2 artifact planner with input/output dependencies for territorial, mesh, place, hydro, terrain and native assets. Stage, validate and publish only affected outputs against the originating branch SHA.
- [x] P8: consolidate affected CI classification and execution; remove proven-unused tools and dependencies; preserve GIS evidence and manual research workflows.
- [ ] P9: verify one final SHA across Web/Qt workflows and reproducible artifacts; compare performance against baseline; record physical-device gaps explicitly.

Constraints: no main integration/deployment without a new instruction; no other worktree changes; no unrelated full test runs; Emscripten and Windows/Linux Qt builds remote only. One subagent maximum. Current formats and behavior remain unchanged. Performance: one warmup, five alternating baseline/candidate runs, one extra round only if ambiguous; repeated regression blocks progression.

## Execution

- Start: worktree clean; local and remote objects at baseline. No uncommitted work to move.
- P6 reference subtask delegated to one agent; polygon/cut/river and central build wiring owned by primary agent.
- Ruling: keep existing Qt QML engine dependencies for UI; remove only product calculation script evaluation. Otherwise QML UI would be broken by an unrelated dependency deletion.
- P6 source ports implemented: polygon/cut/river/reference shared C++, native direct adapters, web WASM adapters, mandatory native JS generators removed. P6 exit validation remains open.
- Remote run 38750407788: polygon 241, cut 6, river 18 and reference frozen fixtures passed. Wrapping compared against obsolete pre-P5 observations; captured actual 8e229826 baseline separately, preserving historical fixtures.
- Remote WASM generation/adapters run 38750414154 passed; verified outputs committed by bot as 9c73c2f3. Latest river workspace/signature and empty-wrapping corrections require the next build.
- P7 graph extension in progress. P8/P9 not complete; no performance or physical-device pass claimed.

## 2026-10-16 execution update

- User changed the verification schedule: finish P6–P8 implementation first; consolidate functional/performance acceptance at P9. No repeated intermediate suites. Fix compilation blockers directly; retain prior evidence.
- P6 shared C++ comparison 38755218968 and compiled WASM publication 38756134022 passed. Bot 68b5e122 fast-forwarded into the objects worktree.
- P6 initial performance showed regressions; bulk polygon marshaling, reference prepared coefficients/mesh arrays and river grid lookup were implemented. Acceptance measurement deferred to P9, not claimed passed.
- Qt Linux 12/13 passed in 38756271115; historical lifecycle winding assertions updated to current canonical contract. No rerun before P9.
- P7 graph/stage/publication implementation ready; actual first data-family publication pending. P8 CI ownership/obsolete native tool paths being consolidated.
- Evidence report: reports/development/testing/p6-p9-execution-2026-10-16.md. Main integration/deployment remains out of scope.

- P7 first real generation/publication38758885726 passed: Web57820b04 -> native989a249f, one guarded push; local fast-forward complete. The earlier run stopped on an obsolete Shapely call, now removed from ordinary preview generation. No new intermediate suites were run.
- P8 implementation wired current manifest/Worker hydro contracts, retained research jobs as explicit dispatch, and removed automatic duplicate publishers. P9 acceptance scope reuses existing affected user-flow tests and matched-run calculation measurement.

## P9 acceptance progress

- P7 selective publication 38760364502 produced 5298b062. P6–P8 implementation is present; acceptance remains open.
- P9 38761625563: Web snapshot passed. Linux app and selected 13 CTests passed; Windows app passed with 12/13 CTests, exposing a dangling QJsonValueRef in the lifecycle fixture reader. The fixture reader now owns the QJsonValue without changing expectations. Linux additional hydro tests exposed a prefix-mapped fixture path, corrected to the existing CMake-provided path.
- Web current Worker checks passed 66 cases with one real wide-source new-country normalization defect. Source 63657333 segments planar longitude spans before deciding spherical winding; the two affected historic baseline observations are retained with explicit current correction fixtures.
- Performance acceptance improved cut, polygon and memory, while river remained uncertain and reference regressed. 63657333 removes repeated calibration fitting, mesh layout reconstruction and JSON temporary conversion costs. P9 resume reuses completed evidence and measures only river/reference.
- Main branch protection API returned Branch not protected (404); no required status contexts were retired or protection settings changed.

## Final acceptance continuation

- P7 final selective generation/publication 38770678701 succeeded, receipt 3ff8598d. Fixed data bytes remained identical; no redundant asset rewrite.
- P9 38771905633 validates product candidate 98c24a6d. Web contracts and Linux river/reference performance passed. Final Windows cut/polygon paired measurements also passed; distributions are retained in DEV-076.
- Linux product build passed; seven calculation/lifecycle CTests passed. The normalizer test still read the old three winding observations and one inline expectation. It now consumes the same explicit correction fixture as Web, retaining the original baseline and checking canonical winding, planar area and immutable input.
- Follow-up 38773827318 selects only the corrected normalizer and six not-yet-executed command/persistence tests, plus the Windows hydro tests not previously reached. Product calculation, app, WASM and asset sources are identical to 98c24a6d; earlier passing evidence is retained.
- Native performance preflight now checks the fixture-declared production place path/hash/revision instead of a retired literal SHA. Ten direct contract cases passed. Missing external v2 performance fixtures still prevent Qt performance acceptance; actual GPU, Windows screen and Android touch remain unverified. P9 is not complete.
