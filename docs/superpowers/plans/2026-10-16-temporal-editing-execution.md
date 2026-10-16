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
- [x] P0 Qt historical insertion, atomic history and stale preparation
- [x] P1 common parent validation and temporal properties
- [x] P1 source availability and historical name evidence
- [x] P2 last viewed month persistence
- [x] Focused Web/WASM/Qt regression evidence and report

Implementation uses one native integration agent; no additional agents. Native and WASM builds run remotely. Main integration/deployment is outside this request.

## Checkpoints and current evidence
- Implementation commits: `1647b22a`, `33559cc2`, `4c12705f`; remote WASM publication: `70bc399c`.
- Shared core focused runs: 38842408846 and 38843753866 passed. Initial run also completed existing Qt core adapter checks.
- WASM run 38842787484: 30/32, two retired source-search expectations found and corrected.
- WASM run 38843756723: all 32 temporal/place/catalog cases passed; published paired JS/WASM/manifest at 70bc399c.
- Focused local timeline corpus: 71 cases passed. Read-model and place publication checks: 19 passed.
- Current generated historical-world rebuilt once via `node tools/build-historical-world-timeline.mjs`: 277 identities, schema11/records2, compressed SHA256 `a1ca6de9f0f087d10d468ad55040c9becbc9a244d5ae0da00cd4003be11da24a`. Native copy verified byte-identical by the existing asset verifier.
- Completed: generated assets, focused browser `tests/browser/temporal-editing.spec.mjs`, selected Qt CTests, report/index. Final code b0db96fc; see DEV-077 for revision-scoped evidence and exclusions.
- Ruling: future app reuses bundled Web UI/WebGL/Worker/WASM. No Tauri shell or new Qt UI implemented here; Qt work is current adapter maintenance.
- Ruling: ordinary deletion retains its current lifetime meaning. Historical library absorption additionally preserves future explicit records, resuming the existing entity at the next explicit change.
- Ruling: restored lastViewedMonth reactivates month editing so editing immediately after reopening cannot fall back to global property writes.
- Ruling: epoch-pinned world results include typed temporal properties; current test doubles must provide `properties`, not rely on missing payload fields.
- Browser startup exposed an obsolete empty-state records factory, then geographic validation incorrectly applied to supplied source relationships. The factory now emits records2 and source initialization has an explicit typed SourceAdmission context. User edits and library changes retain strict geographic validation; no country ID exceptions or tolerance changes.
- Shared C++ run 38845287754 passed at 3293a569, covering strict user rejection versus source admission.
- WASM run 38845290314 compiled successfully, then stopped at a retired test import. Its retained paired artifact was source-identity verified and reused without rebuilding; corrected temporal/place/catalog suite passed 33/33 locally. Pair published in 4407b18a, core source fingerprint `e596398eb0bfb2fe2fd70f39560d22ef569f1793627f80552555bc4a88af2f83`.
- Qt run 38844805344 stopped on an ambiguous namespace in a new test, before CTest. Qualified the actual Qt codec; subsequent target results are recorded below.
- Qt run 38845721551 compiled and passed historical transaction/editor/catalog targets. Two remaining targets exposed a missing saved-month recovery call, retired asset hash/count expectations, a duplicate old v3 naming contract, and tests assuming selection survives history. Recovery now uses the same saved-month helper as file open; manifest assertions use actual Web bytes; current v3 has one owner; Undo/Redo tests assert canonical selection clearing and reselect before model checks.
- Browser diagnostics proved Undo's model is correct. Redo restored the identity but omitted an unchanged native allocation that Undo had removed from the published Web semantic archive. Fixed encodeWebDelta to publish every newly visible semantic reference; small WASM/read-model regression reproduced failure before the patch. Remote WASM run 38846818975 at aa80662a validates this fix.
- WASM run 38846818975 passed 34/34 and published 86195631, source fingerprint `26ce3593a3e5df2603110fe9fc72c0303bf02f6a3abecf89661444b9a98c7146`. Native remaining two targets rerun at 7ab96bac in run 38847292223. The three already passing native targets are not repeated.
- Browser passed insertion, history, 2011/2012/2013 properties and autosave, then found prepareImport dropped the codec's validated editorState hint before startup admission. validateImport now carries that detached hint without changing the live cursor. Small WASM regression reproduced the drop before patch; run 38847827217 at 24e046d8 validates the fix. The browser budget is 240s for two startups plus a real USSR import, matching existing library workflow budgets; individual assertions and geometric tolerances are unchanged.
- Qt run 38847292223 passed place naming and all but one timeline controller scenario, including saved-month autosave recovery. Remaining geometry edit used a huge overlay selection radius, pulling an antimeridian vertex outside parent C. The test now projects geographic (10,0) exactly and moves inward to (9.5,0.5); strict containment remains unchanged. All history assertions explicitly reselect after the canonical selection clearing, including the final geometry Undo/Redo.
- Final WASM run 38847827217 passed 34/34 and published 707358c4, fingerprint `18634595bb1b792fd9ddf8cb88e63a2b214b6f1d54f0ff66eac43c2a2c1f46e7`. Real Edge scenario passed in 2.8min including reopening at 2012-06 and exact earlier-month geometry/properties.
- Final Linux Qt timeline controller run 38848365494 passed. Together with historical transaction/editor/catalog in 38845721551 and place sync in 38847292223, all five affected native targets have passing evidence.
- Real reload/teardown exposed old-page queries misreported as unloaded documents/autosave failures. Retired owners now cancel queued work using existing cancellation/epoch rules; active failures still propagate. Five focused Node owner suites passed 68/68, with the final persistence suite rerun 23/23 after tightening active AbortError reporting. Final browser rerun passed in 2.9min, including diagnostic assertions and explicit page exit with no errors or retired-work warnings.
