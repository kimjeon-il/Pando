# P6–P9 execution ledger and approved implementation contract

Baseline: `8e22982616e3c9ba43eeb84baec17cd886267cfa`, permanent `work/objects`.

The approved conversation plan is the specification. Implement in this order:

- [x] P6: port polygon-clipping 0.15.7 behavior to shared C++; wire native and WASM; port cut/river calculations; port reference image calculations; retire product QJSEngine scripts and required Node build/test dependencies. Preserve current formats, cancellation, atomicity and Undo/Redo.
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

## Scoped P9 failure resolution

- Browser startup/screenshot checks and Russia cancellation/creation, static persistence and complex timeline flows passed in 38776249593. Reuse these results. Remaining annex cases passed locally with trace disabled; remote follow-up retains the same geometry/model/Undo assertions.
- Fixed a real reference placement wiring defect: a JS project wrapper lost the prepared warp identity required by mesh generation. C++ placement preparation now carries bounds/flip data, with a single prepared owner shared by point projection and mesh generation. WASM publication 38780159459 produced 607d0e64; 12 direct reference cases passed. Reference-only final paired measurement passed without repeating other calculation metrics.
- Native 38777255148 built both apps; Linux passed five selected tests, with current persistence fixtures/contracts and event-based river cancellation still requiring follow-up. Windows selected CTests actually executed zero because of PowerShell filter argument precedence; that is not a pass. Added --no-tests=error and explicit OS-specific target selection, current manifest fixtures, LF hashes and persistent failure logs.
- Native follow-up 38781160361 selects only Linux five and Windows ten unresolved targets. P2 38781165569 succeeded and published actual result 05fabceafee3a6b1fd0afdc2a2f70e4b4c691de6 from source 44276b96. Fixed data bytes did not change; only dependency receipt/build metadata/index changed.
- Browser 38782006562 targets the five unresolved cases and the not-yet-run browser paired comparison on this actual published result. No additional local duplicate runs or full suites. P6 exit acceptance and P9 remain open until these results; unavailable Qt performance fixtures and physical-device evidence remain explicit gaps.

## Acceptance receipts at 4e53feee

- Both latest product apps built on 44276b96 under interpreter guards. Linux remaining hydro/reference/physical tests passed; Windows passed eight of ten selected targets, including current normalizer and command/Undo flows. Product/native assets and shared calculation sources have not changed since those builds.
- Remaining persistence checks passed 107 cases on both OSes. Two newly added hydro fixture cases retained the pre-edit Web document identity; corrected via the current codec factory, retaining exact final byte comparison. A Windows preview fixture also flattened a single QJsonArray; fixed explicit value nesting and restored the original genuine sweep-failure assertion.
- 38786479504 verifies only Linux persistence and Windows persistence/preview, without rebuilding/capturing the app. No completed tests are added to this follow-up.
- Web component annex and live-wire passed in 38783631339; line-refine passed in 38782006562. Polygon and multiple-crossing annex passed locally but hit the remote 180-second workflow budget; their remote completion is not claimed and they are not repeated again.
- Performance-only 38786487427 reached the fixed baseline focus/view-change but exceeded the 30-second 120-frame collection deadline in its first warmup. No paired distribution or frame/memory non-regression is claimed. Output JSON now persists even on failure. Future collection budget is explicit; no further browser measurement is run in this task under the user's minimal-check constraint.
- Qt performance fixtures and physical GPU/Windows-screen/Android-touch evidence remain unavailable. P9 remains incomplete; do not merge/deploy or claim full acceptance.

## Final scoped receipt

- 38786479504 succeeded on 4e53feee0a69d0e44c19b92f0e14f4a3a297093f: Linux persistence 1/1 CTest; Windows persistence/preview 2/2, with 109/35 Qt cases passed. Retain earlier passing app builds and unchanged functional/calculation evidence. P6 exit checks are satisfied within that recorded scope.
- P6–P8 implementation is complete and pushed on work/objects. P9 is deliberately unchecked: remote annex polygon/multiple-crossing timing, paired browser startup/frame/heap distributions, missing external Qt performance fixtures and physical-device validation remain open. No main integration, deployment or category transfer.
- Future frame collection deadline is explicitly 120 seconds (same 120 samples and unchanged comparison rule); syntax checked only. No further browser rerun was made under the user's minimal-check instruction.

## P9 resume after explicit completion request

- Reuse completed evidence; run only outstanding browser distributions and physical-device/Qt measurements. Candidate product is unchanged from deployed `8aaee62c`; baseline remains fixed at `8e229826`.
- Actual headed Windows Chromium/GTX 1650/Direct3D11 annex polygon and multiple-crossing flows passed with unchanged final-model, conservation and Undo checks. Persisted device/context JSON and screenshots accompany 31.7/30.8-second results.
- Browser paired comparison resumed as 38810034862 using the already documented 120-second collection budget. Result pending.
- Extend the existing native probe with an opt-in P9 relative profile and production-full-world inputs; identical measurement overlay on baseline/candidate, remote builds only. This does not certify the historical M98 full-stack/stress gate.
- Android physical touch remains pending a connected device. P9 remains unchecked until actual outstanding results exist.

### Device/performance receipts

- Physical GTX 1650 browser startup/editable/JS-heap comparison completed ten alternating pairs. Those three metrics show no regression; focus-frame p95 remains uncertain after the one permitted extra round. Do not repeat or relabel it passed.
- Remote Windows baseline/candidate Qt measurement binaries were built successfully in 38812500369, using identical measurement overlays. Local production fixture preparation hit the QtTest 300-second limit; native distributions remain unavailable.
- The separate full-RUS edit/Worker/autosave group hit an asynchronous test setup race after successful warmups and one pair. The helper now awaits actual drawing-mode readiness; unfinished samples are retained and excluded from acceptance.
- Android 16/Edge on the connected Galaxy S22+ reached editable, but no completed touch flow was recorded before the user disconnected it. Android touch remains unverified. P9 is still unchecked; no main integration/deployment.

### Bounded measurement outcome at f90ccf21

- Full-RUS edit/Worker/autosave completed the first five pairs and four additional pairs before the 30-minute overall deadline interrupted the last autosave. The first five pairs show lower Worker RTT/compute and autosave medians, unchanged/lower LongTask medians, and uncertain edit-frame p95. Overall status remains unverified; retain raw evidence and do not repeat this group.
- One 30-second verbose fixture diagnostic reached the preview future's `Pinned world preview unavailable: Unknown exception` error; the constructor/event loop are responsive. All nine world assets match manifest size/hash and compressed inputs fit existing decode limits. The underlying decoder/loader failure is not identified; no Qt frame/startup/memory distributions are claimed.
- Stop expanding checks. Remaining P9 gates are explicit: unresolved web frame acceptance, native preview failure before paired measurement, and disconnected Android touch proof. Completed functional/build/asset evidence is retained, and P9 remains unchecked.
