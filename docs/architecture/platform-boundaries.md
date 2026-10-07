# Web / App portability refactor

## Fixed behavior and source pair

Approved plan: behavior-preserving internal refactor of both repositories. No UI,
geometry algorithm, persistence schema, command timing, or history semantics change.
Web baseline: `008b99b5ca2dd39936e51f7ddd11c0c70fc7bb74`.
App baseline: `3934077519bb716cbb45b683bbb63d85dcc8d5ee`.
Each platform is compared with its own baseline; existing platform differences are
not silently repaired. Archived oracle sources and historical fixtures stay immutable.

## Canonical responsibility map

| Responsibility | Web owner | App owner | Boundary / verification |
| --- | --- | --- | --- |
| Document and identity | TerritorialEntityStore, Repository, project-state | Project, ProjectDocument, DocumentIndex | Services/commands write; selectors read; model and territorial tests |
| Ordinary commands | ProjectCommandPipeline, domain services | CommandProcessor, ChangeSet, Project | Existing validation, no-op, commit and rollback; command tests |
| Async edit | runProjectTransaction, map-edit-worker-client | CommandJobRunner, JobScheduler, CommandProcessor | Existing revision/cancellation/commit-discard rules; transaction/job tests |
| History and dirty | history-service, save-state-controller, ProjectDomain | Project, EditorController draft routing | Document history and draft history remain separate; command/editor tests |
| Selection | object-selection-controller, SelectionDomain | SelectionState, editorselection | Ordered references and primary; selection trace corpus and UI tests |
| Geometry draft | EditingDomain, existing draft/edit calculators | map engine editgeometry, editor geometry session | Pure draft state versus platform presentation; editing tests |
| Geometry calculations | map-edit calculators, polygon and boundary modules | geometrycalculator, map engine, territorialmutation | No algorithm, precision or ordering changes; existing geometry oracles |
| Timeline | temporal, timeline-records/storage, geometry-version-store | temporal, timeline-records/storage | Existing records/activation restrictions; fixed shared fixtures |
| Persistence | project-serializer, persistence-service, browser storage adapter | projectcodec, ProjectAutosave, ProjectStorage | Codec separate from I/O; save/reopen/recovery tests |
| GIS and library | GIS domain/import-service/library-service | gisexchange, catalog/Qt import adapters | Existing import/commit boundaries and source identities |
| Content | territorial/distribution/generic services, place runtime | content, objectproperties, editor content adapters | Current domain validation, locks and references |
| Physical data | physical-layer-service, place/hydro/terrain loaders | physical data stores/providers, map engine resource policy | Existing demand/retry/cache lifetime; provider tests |
| Rendering | RenderingDomain, map-render-coordinator, GPU owners | map engine, MapSceneBridge, Qt renderer | Read-only document consumption; revision-tied caches and handoff tests |
| UI/lifecycle | composition, capability ports, UI controllers | EditorController, QML, platform adapters | Input translation and publication; browser and Qt UI tests |

## Interface rules

- Keep JS and C++ production interfaces native to each implementation. No universal
  command envelope or event bus. Cross-platform observations are test data only.
- UI -> application command/workflow -> canonical model/calculator. Platform I/O,
  frame scheduling, and nondeterministic values enter at composition boundaries.
- Keep the synchronous command pipeline distinct from async project transactions.
- Do not copy mutable selection/document state into presentation owners. Derived
  references and caches must identify their canonical source and invalidation.
- Preserve callback order and history boundaries during extraction. Post-commit
  render/autosave failures must retain the existing committed-state behavior.
- Web is the source of shared fixtures; native consumers verify the frozen source
  identity and bytes. Never rewrite archived oracle expected results to get green.

## Execution ledger

- Setup: both clean repositories match the fixed pair; work uses dedicated
  `codex/platform-boundaries` branches in the existing checkouts.
- Ruling: use the clean local checkouts and dedicated branches instead of creating
  extra checkouts; no main commits, merge, push, deployment or packaging.
- Ruling: preserve existing mechanisms and select checks by affected dependency
  graph; the repository testing instructions override blanket full-suite advice.
- Pre-flight: storage extraction changes runtime imports and architecture guards;
  frame/ID injection changes composition and test factories; native draft extraction
  changes controller access and engine tests. Consumers change in the same step.
- Baseline Web: focused command/transaction/domain/persistence/service/composition/
  history checks: 73 passed, 0 failed (2026-10-07).
- Baseline App: command, geometry, command-editor, selection-editor and timeline
  persistence executables: 5/5 passed before editing.
- Implementation: browser storage I/O moved intact to browser-project-storage;
  persistence-service keeps queue/recovery policy. Both project persistence and
  reference-image storage use the adapter. Runtime composition injects the existing
  object-ID factory and frame scheduler. History candidate normalization/validation
  moved intact from composition to project-state.
- Selection: Web selected is a derived getter; its notification carries the previous
  immutable selection to preserve old-target cancellation. App selectedId reads
  SelectionState with the existing project-instance guard. No second writable ID.
- Editing: App GeometryDraft owns geometry, indices, undo/redo and drag history in
  the existing map engine. Qt session retains presentation, job tokens and tools.
- Unchanged after boundary audit: ordinary/async command processors, geometry
  algorithms, current codecs/autosave, timeline/relations, GIS/library/provider
  loading, rendering ownership and cache invalidation. Their existing boundaries
  are retained; this change does not replace their implementations or claim new
  platform feature equivalence.

## Changed internal contracts

| Entry | Input and identity | Result / failure | History and publication |
| --- | --- | --- | --- |
| Territorial service construction | Existing Store/Repository/pipeline plus required createId | Missing provider fails immediately; independent-region creation uses the same project ID factory | Existing command result, validation and undo unit |
| EditingDomain construction | Required draftServices.requestFrame/cancelFrame pair | Missing scheduler fails immediately; production uses original browser scheduler | Original preview scheduling, cancellation and disposal order |
| SelectionDomain publication | Current snapshot, reason, previous immutable selection; object-ref domain/type/id keys | Same no-op filtering and project reset | Callback precedes render invalidation; no document undo |
| App selectedId | Current SelectionState primary ObjectRef and project instance | Empty for no selection or a replaced instance | Existing selection signals remain at their old call sites |
| prepareEditableProjectSnapshot | Current history snapshot, existing collection normalizers, optional geometry reuse | Detached validated candidate; invalid references throw before application | Existing history-service travel/rollback and later notifications |
| GeometryDraft history | Native Geometry and vertex indices; detached drag-before value | Exact old push/pop/restore rules, including vertex/object no-op differences | Draft history only; controller still commits through CommandProcessor |
| Browser project storage | Existing IndexedDB/localStorage objects and database/key options | Same read/write failures and fallback rules | Persistence service still owns serialization, queue/recovery and saved state |

Object IDs are not feature FIDs or source IDs. Selection fixtures use explicit
domain/type/id references and native ObjectRef conversion in selection_probe.
The comparison retains array order, exact keys, revision counts and scoped anchors;
it does not round coordinates, sort output, or omit differing fields.

## Verification and limits

- Web focused unit checks: 147/147; reference-image store: 4/4; Python architecture
  checks: 13/13. Changed JavaScript ESLint and runtime boundary checks pass
  (305 modules, no circular imports).
- Browser: selection/territorial commands/timeline persistence 6/6; reference-image
  overlay 6/6. One additional WebGL2 coastline Worker handoff case passed. The
  broader 21-case handoff run was stopped after that case to narrow the scope;
  its remaining cases are not counted as passed.
- App core/controller focused CTest: 8/8. Additional job, territorial geometry,
  screen-edit controller executables pass. Native UI results are recorded in the
  App validation ledger after completion; aggregate timeouts are retained there.
- Shared selection: 14 expected, 14 Web, 14 native, 0 mismatches. Timeline record
  verdicts 60/60, storage verdicts 25/25, complete storage snapshots 11/11 match.
- No claim of complete pre-existing Web/App parity, all geometry inputs, hardware
  renderer coverage, all provider/network failure paths, or every UI path. Existing
  native/Web storage representations and activation restrictions remain distinct.
  Unchanged historical fixtures and oracle source pins remain authoritative.

## Reproduction

Web: `node --test tests/unit/platform-boundaries.test.mjs tests/unit/platform-portability.test.mjs tests/unit/persistence-service.test.mjs tests/unit/reference-image-store.test.mjs`
and `node scripts/check-runtime-boundaries.mjs`.

Browser: `node node_modules/@playwright/test/cli.js test tests/browser/selection-domain-smoke.spec.mjs tests/browser/territorial-common-commands.spec.mjs tests/browser/timeline-persistence.spec.mjs tests/browser/reference-image-overlay.spec.mjs`.

App: build the named executables in its validation ledger; run the focused CTest
regex and Qt input invocations recorded there. Run
`node tools/verify-platform-portability.mjs WEB_ROOT SELECTION_PROBE` from App.
The App pin verifies both Git-committed and local fixture bytes before comparison.
`tests/fixtures/portability/manifest.json` stores the original pair and fixture hashes.
