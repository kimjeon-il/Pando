# P6–P9 execution ledger and approved implementation contract

Baseline: `8e22982616e3c9ba43eeb84baec17cd886267cfa`, permanent `work/objects`.

The approved conversation plan is the specification. Implement in this order:

- [ ] P6: port polygon-clipping 0.15.7 behavior to shared C++; wire native and WASM; port cut/river calculations; port reference image calculations; retire product QJSEngine scripts and required Node build/test dependencies. Preserve current formats, cancellation, atomicity and Undo/Redo.
- [ ] P7: extend the existing P2 artifact planner with input/output dependencies for territorial, mesh, place, hydro, terrain and native assets. Stage, validate and publish only affected outputs against the originating branch SHA.
- [ ] P8: consolidate affected CI classification and execution; remove proven-unused tools and dependencies; preserve GIS evidence and manual research workflows.
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
