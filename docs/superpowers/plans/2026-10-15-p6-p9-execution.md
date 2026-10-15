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
- Verification not yet executed; no P6–P9 completion claimed.
