# Editable library editor and native code review

> Report ID: `UI-LIBRARY-REVIEW-20261021` · Status: `reviewed-important-findings-resolved / native-workflow-unverified` · Geometry application: `not-applicable` · Indexed: 2026-10-21  
> Source revision: Web/App `4f35c345e0707c44e383cca027e119207f93259c` plus uncommitted implementation in permanent `work/ui`  
> Scope: accepted [implementation plan](../../../docs/superpowers/plans/2026-10-21-editable-library.md), root editor/adapter/UI, isolated geometry startup/storage, native repository/working drafts/GitHub sync. Separate publication implementation excluded.

## Verdict and method

Changes requested for three Important findings; no Critical finding identified. The implementation follows the planned ownership split: committed library service, isolated unsaved source editor, native revision store, and separate geometry document. Exact dates remain source fields, normal project imports copy geometry, native GitHub operations keep authentication outside JavaScript, and publishing has an explicit command. Nevertheless, external geometry/date edits cannot currently pass the native acceptance contract; remote source validation can occur after activation; and the metadata form silently drops existing precision values. These prevent full specification compliance.

Reviewed current filesystem code and the supplied patch, including latest geometry dirty guard. Ran two narrow reproductions described below. Existing 19 JS tests, 3 provenance tests, 3 browser component tests, and 15 native tests were reported by the implementers and were not rerun in this review. They are not evidence of real native WebView operation. No product code edited by this review.

## Important findings

### R1. External source correction cannot pass raw-draft equality after canonical normalization

- Location: `apps/web-shell/src-tauri/src/library_working.rs:148`; callers `assets/js/modules/territorial-library-editing-ui.js:82` and `assets/js/modules/territorial-library-editor.js:37`.
- Trigger: edit an existing working JSON version's validity dates or coordinates, or add a new entity, then select **자료 다시 읽기**.
- The reload path calls `editor.apply(changes)`, which adds provisional `historicalProvenance` through `markEditedLibrarySource` and normalizes the raw entity. The native `validate_working_commit` then requires each submitted entity to equal the unnormalized raw working JSON exactly. The required provenance update itself makes that equality false. New sources can additionally gain canonical defaults.
- Reproduction: loaded the real bundled `state:KOR`, changed its first geometry version's `validFrom` to `1948-08-15`, and exercised the real editor apply/save path with the native equality rule reproduced as deep JSON equality. Raw version had no `historicalProvenance`; submitted version had provisional/false verification flags. Save rejected with `External working source changes must be validated through 자료 다시읽기 before saving`. Active revision did not advance, but the advertised correction workflow cannot finish.
- Fix direction: bind acceptance to an immutable external-candidate identity/hash separately from the normalized committed entity. Recheck that raw candidate is unchanged before atomically accepting the validated representation. Do not remove provenance invalidation or silently bypass concurrent external-change detection.
- Missing regression: real JS normalization -> native working-candidate acceptance for a date/geometry edit and a minimal new source, plus a concurrent raw-file change rejection.

### R2. Remote synchronization advances the active head before full source/index validation

- Location: `apps/web-shell/src-tauri/src/library_sync.rs:239-240`; activation `library_repository.rs:343`.
- Trigger: an already synchronized installation pulls a content-addressed remote revision whose JSON is hash-correct and schema-2/identity-correct but has an invalid date, overlapping versions, invalid lineage membership, or index/source metadata mismatch. This is possible for a manually edited private data repository even without corruption of hashes.
- Sync verifies blob hashes, schema numbers, source IDs, and the set of indexed IDs, then calls `accept_remote`. For a clean local head this immediately writes the new active revision and refreshes editable working files. Full `normalizeTerritorialLibraryIndex` validation only happens later when JavaScript calls `repository.open()` during UI reload. Thus an invalid catalog can become the active native head before the reload rejects it. Subsequent opens keep rejecting that same head. Source/index metadata disagreement is also not checked by `createRepositoryTerritorialLoader`, unlike the packaged loader.
- Evidence: direct code-path inspection; no live GitHub call or remote mutation made. The repository state transition is unconditional after the shallow checks for a clean synchronized head.
- Fix direction: stage the remote snapshot as a candidate, validate the complete current catalog and all sources (including indexed metadata agreement) before changing `state.json`, then accept with a checked expected revision. Invalid remote data must retain the last verified active head and editable working baseline. Use the same canonical validators rather than a second divergent schema implementation.
- Missing regression: hash-correct remote invalid date/overlap and mismatched source metadata must reject without changing active revision or working files.

### R3. Saving an unrelated metadata edit erases current date-precision values

- Location: `assets/js/modules/territorial-library-editing-ui.js:44`, `:68`, `:13`.
- Trigger: open a source with an existing precision such as `exact` (bundled example: `state:east-prussia`), change only its name, then save.
- Current catalog precisions are `current`, `reference-year`, `approximate`, `reference-date`, `exact`, and `historical-range`. The select offers only `date`, `month`, `year`, and `current`. Assigning a missing option in `fill()` clears the select. `collect()` then writes its empty value into the selected version even though the user never changed precision, and neither entity/index normalization rejects that value.
- Reproduction: enumerated precision values from the actual bundled schema-2 index; actual headless Chromium with the same option list returned `{value: '', selectedIndex: -1}` when set to `exact`. This was an isolated browser check, not a WebView test. An initial attempt imported unavailable `playwright`; the successful check used the installed `@playwright/test` package.
- Fix direction: use the current source precision contract in the form and enforce its valid values at the shared validation boundary. Preserve an existing precision when an unrelated field changes.
- Missing regression: name-only saves preserve each current catalog precision value.

## Minor observations

- Open-time sync is not currently invoked immediately: editing UI registers focus/online handlers and a 60-second timer, but neither creation nor controller `open()` calls `sync()`. First library open in an already focused window can remain stale until the timer. Accepted plan calls for synchronization on open as well as focus/save/periodically.

## Verification boundaries

- Full native Cargo integration remains unverified because the reported Windows linker/device failure occurs before this crate; not classified as a product defect here.
- Real native WebView startup, separate geometry window editing/close guard, gzip asset resolution, and native save workflow still need execution. Component tests and source inspection do not certify them.
- Remote provisioning, live push/workflow dispatch, and first publish are explicitly a separate rollout. No absence of those side effects was classified as a defect.
- No historical geometry was researched or validated, no 0.5 CSS px claim is made, and no map data was applied. Provenance invalidation is appropriate; R1 must be fixed without weakening it.
- Existing unrelated deleted tests, generated permissions, and artifacts were not restored, modified, or removed.

## Revision

Initial review of the uncommitted implementation on 2026-10-21. Findings refer to the reviewed source before any follow-up fixes; a follow-up review must explicitly record resolution evidence.

## Bounded post-fix review, 2026-10-21

R1, R2 and R3 are **resolved in the reviewed implementation and focused local evidence**. This is not a claim of native WebView verification. The initial findings above remain as historical evidence. One Important receipt-presentation gap remains below, so the overall status stays `changes-requested`.

- **R1 resolved:** external candidates now carry `externalRevision`, a native fingerprint of baseline plus every working filename and exact byte hash. The editor preserves that token through apply/history/save. Native commit verifies unchanged raw candidates and complete changed/deleted identity coverage separately from the normalized JSON, allowing required provenance/default normalization. Native refresh uses the same token before replacing accepted working files. The additional JS test checks fingerprint forwarding with added provisional provenance; native tests cover accepted normalized sources, later byte/filename changes, and omitted candidate identities.
- **R2 resolved:** unknown remote snapshots are staged immutably and return `validation-required` without writing active state. The bridge reads that exact candidate, invokes current catalog/entity validators, compares all canonical indexed metadata/version metadata through `assertTerritorialIndexEntity`, validates geometry, then resubmits the validated content revision. Native sync refetches and requires the same candidate hash. Tests cover invalid date without state change, index/source disagreement without admission, isolated candidate reads, changed remote invalidating an old token, and successful admission of the newly validated token. Required `library_read_candidate` command wiring is present.
- **R3 resolved:** the select now includes every current catalog precision and preserves an encountered current source value before assigning `select.value`. The new browser regression uses actual `state:east-prussia` with `exact`, changes its name, and asserts saved precision stays `exact`. Recorded RED and GREEN evidence was inspected.
- **Native known-committed receipt resolved:** `Repository::commit` advances `state.json`, then returns the accepted revision/index with a `PL-LIBRARY-WORKING-REFRESH` warning if derivative materialization fails. The Windows lock regression asserts accepted entity/new revision despite locked baseline, then verifies another save succeeds after lock release. This correctly distinguishes committed storage from derivative refresh.

Evidence inspected, without rerunning suites: `build-native/editable-library-units.log` shows 26 passed/0 failed; `build-native/editable-library-browser.log` shows 4 passed; `build-native/editable-library-precision-red.log` records the original precision failure; `apps/web-shell/src-tauri/target/editable-library-tests.log` shows 21 passed/0 failed. Test sources were inspected to ensure their assertions cover the stated contracts. Full native Cargo/WebView limits remain unchanged.

### R4. Known-committed warning is lost before the UI can present it

- Reviewed location: `assets/js/modules/territorial-library-editing-ui.js:100` (save action); native reopen at `apps/web-shell/src-tauri/src/library_repository.rs:205-207`.
- Trigger: save successfully commits, but a working file or baseline remains locked, so native commit returns the new revision plus the working-refresh warning.
- The save action runs `await reload()` before `if (saved.warning)`. Reload calls `repository.open()`, whose `ensure_working()` retries the still-locked refresh and rejects. Control never reaches warning presentation. The user gets a generic operation-failure notification despite the source having been saved. The JS editor has already accepted and cleared its draft, making correct explanation of that durable result essential.
- Related paths currently ignore the same warning on external-reload save, delete, conflict selection, and sync. Geometry save returns the warning but the file button reports unconditional success, so it does not surface the working-copy problem.
- Required change: consume the successful receipt and present its warning before any mandatory reopen or sync. Preserve the accepted revision/catalog, report that the library source was saved and the working copy needs refresh, and avoid converting a derivative failure into a failed-save result. Add a browser boundary test with commit returning a warning while subsequent open continues rejecting; ensure the accepted source and warning remain visible without a false save failure.
- Ruling: Important, still open at this bounded review. Root implementer notified; no product code changed by the reviewer.

## Receipt follow-up review, 2026-10-21

**R4 resolved for the reported Important failure path. All four reviewed Important findings are now resolved; no unresolved Critical/Important finding in this bounded editor/native review.** Earlier verdicts above describe their respective pre-fix snapshots.

Save/delete now present the accepted receipt through `showCommitted` before optional synchronization, and skip sync when that receipt contains a warning. External reload keeps the save receipt; conflict selection accepts the complete native receipt and applies it directly. Sync preserves returned warnings. A locked working refresh no longer makes `library_open` reject verified active data: it returns the active revision plus a warning, while validating immutable active objects before doing so. Active source corruption still rejects rather than being downgraded to a working-copy warning.

Inspected the new browser assertion that save makes no extra `open` call, displays the warning, retains the saved name, emits no failure, and reopens the saved entity. Inspected native assertions for reopening with the same revision under a persistent lock and for rejecting corrupted active bytes under that lock. Existing recorded output now shows **5 browser tests passed** and **22 native tests passed**. No suite was rerun during this follow-up, and these are not real WebView execution results.

Nonblocking presentation observations: native `warning.message` contains the raw refresh error, whereas the browser fixture uses an explicit saved/refresh-pending explanation; adding that explanation at the UI boundary would make the durable result clearer. Geometry save button and shortcut still do not surface a returned working-copy warning, although they correctly retain the saved revision and do not falsely report a failed commit. These are minor presentation follow-ups, not a recurrence of R4's false-failure control flow.

Native integration build and actual WebView/source-edit workflow verification remain unverified under the previously documented environment limits. No claim of deployment, remote publication, or historical geometry verification is implied by this review status.
