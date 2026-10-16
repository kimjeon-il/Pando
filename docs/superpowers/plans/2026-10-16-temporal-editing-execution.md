# Temporal editing execution

Source: `adf34990` on `work/objects`. Approved in conversation 2026-10-16.

## Rules
- Source selection date is provenance; insertion uses the active map month.
- Dated edits last until the next explicit change for the same field.
- Administrative parents must contain children over the affected interval; ordinary reparenting never expands geometry.
- Name, flag and color get independent temporal overrides. Existing identity/style fields are immutable baseline defaults during dated edits, not a second current editable state.
- Unknown historical place names display `(현)` immediately before the modern name, per user correction.
- Cursor stays session state. Serialized editorState.lastViewedMonth is a reopening hint, excluded from document undo/dirty semantics.
- No old format readers. Regenerate current generated inputs and update affected fixtures.

## Execution ledger
- [ ] P0 Qt historical insertion, atomic history and stale preparation
- [ ] P1 common parent validation and temporal properties
- [ ] P1 source availability and historical name evidence
- [ ] P2 last viewed month persistence
- [ ] Focused Web/WASM/Qt regression evidence and report

Implementation uses one native integration agent; no additional agents. Native and WASM builds run remotely. Main integration/deployment is outside this request.

## Checkpoints and current evidence
- Implementation commits: `1647b22a`, `33559cc2`, `4c12705f`; remote WASM publication: `70bc399c`.
- Shared core focused runs: 38842408846 and 38843753866 passed. Initial run also completed existing Qt core adapter checks.
- WASM run 38842787484: 30/32, two retired source-search expectations found and corrected.
- WASM run 38843756723: all 32 temporal/place/catalog cases passed; published paired JS/WASM/manifest at 70bc399c.
- Focused local timeline corpus: 71 cases passed. Read-model mock and retired name-coverage assertions updated; final focused rerun pending.
- Current generated historical-world rebuild started once via `node tools/build-historical-world-timeline.mjs` (exec session 37905). It is generation for schema11/records2, not an audit or a full test suite.
- Pending: finish generated asset update, focused browser `tests/browser/temporal-editing.spec.mjs`, selected Qt CTest including historical_transaction_tests, historical_editor_tests, timeline_controller_tests, place_sync_contract_tests and territorial_library_catalog_tests, report/index.
- Ruling: future app reuses bundled Web UI/WebGL/Worker/WASM. No Tauri shell or new Qt UI implemented here; Qt work is current adapter maintenance.
- Ruling: ordinary deletion retains its current lifetime meaning. Historical library absorption additionally preserves future explicit records, resuming the existing entity at the next explicit change.
- Ruling: restored lastViewedMonth reactivates month editing so editing immediately after reopening cannot fall back to global property writes.
- Ruling: epoch-pinned world results include typed temporal properties; current test doubles must provide `properties`, not rely on missing payload fields.
