# Shared core and startup implementation ledger

> Report ID: `DEV-066` · Status: `implemented / bounded verification` · Map data: `not-applicable`
> Source date: 2026-10-12 · Updated: 2026-10-13 · This is an implementation checkpoint, not full parity or measured startup performance.

Baseline: `930060923889d17134e36e152c29f4adbb2e60a9`, `work/objects`.

## Final handoff — 2026-10-13

The user requested stopping additional investigation and reducing checks at the
account limit. Code and the required paired WASM runtime are preserved locally;
there is no main merge, push, deployment, portable build or application execution.

- C++ document/timeline/commands/history/selection/draft ownership is active in
  Native and the Web Worker. Former writable JS pipeline/history/transaction
  owners and unused runtime codec ports are removed. Platform codecs and the
  canonical shared JS geometry calculations retain their existing roles.
- Native startup prepares validated Project/read model/projection/scene data
  off the GUI thread; bounds do not build whole-world SVG text. Hydro admission
  uses background verification and file/version-bound receipts. This removes
  the identified synchronous code paths, without measuring actual responsiveness.
- Final packaged shared-source SHA: `3c3681de6df16caaa62bfc133f9a9335935f41dab49ac29598f178120def6cde`.
  Emscripten `4.0.20`, ABI `1`; JS SHA `64db0857e689f64aae845d3d797934089ceb0d9e68767543f3e4be11b660dfdd`;
  WASM SHA `9121cd9b87a0e898406366d495bb26517d547c60b8807d3381e5bf974dfe1556`
  (2,522,239 bytes). Source/compiler/ABI and coherent pair verification passed.
- Final native Core group: 8/8 passed (2.99 s). The last Web domain bundle first
  passed 22/33 and exposed two wiring errors. Exact typed territorial targets
  fixed the nine affected import/library cases: 9/9 passed. The embind shape
  check incorrectly required begin/finish coordinates; its minimal correction
  passed one native case and the original plus actual label cases, 3/3.
- Startup, pure import inspection, preview policy and autosave receipt group:
  29/31 initially passed. Its two new test inputs used the wrong source protocol
  or omitted required factory fields. After correcting the fixtures, both cold
  delta cases passed individually with unchanged product expectations.
- Current originals additionally verify exact history limit 30, raw settings,
  moved/unmoved label Undo, live physical settings through Undo, hydro source
  aliases without dirty/history clocks, and view-only retained-candidate rebasing.
  Original fixtures/pins were preserved; no coordinate rounding or broad field
  exclusions were introduced. Failed platform effects cannot leak their transient
  document through an autosave/file export outside the application queue.
- Existing native hard label-reference and RGB-only wire representations remain
  explicit platform boundaries. Native current-file zero/default representations
  are not reported as byte-identical to Web empty-string/explicit-true fields.
- NOT_RUN: real app/BAT/portable/offscreen/Qt UI, actual browser UI, full-world
  time/memory measurement, complete final App link and remote CI/full parity.
  The last two Native controller changes were source-guard checked; their final
  syntax-only repeat and regenerated QtCore geometry harness repeat were omitted
  at the user's check-limit instruction. Earlier bounded evidence follows below.

Reproduce the standalone source build with `shared/README.md`, the CI commands in
`.github/workflows/shared-core.yml`, and the immutable original fixture manifests
in `tests/fixtures/portability/web-9300609-*`. The sections below are chronological
checkpoint evidence; they are not all rerun against the final packaged pair.

User constraints: never launch the application, BAT, portable, offscreen app or
Qt UI tests. Only static inspection and bounded small non-GUI tests. No main
integration, push, deployment or portable packaging. Preserve GIS worktree changes.

Architecture: C++ core shared by native and Web WASM; current Web behavior is
the contract. Existing geometry kernels and platform storage formats stay.

## Ordered work

- [x] Startup code boundaries: lightweight projection, prepared world installation
      and scene, asynchronous hydro admission and source provenance.
- [x] Shared source ownership and build boundaries, current Web oracle cases.
- [x] Timeline/read model through native and WASM, with small exact fixtures.
- [x] Model/commands/history/dirty through native and WASM.
- [x] Selection/drafts/async commit/discard through native and WASM.
- [x] Storage adapters, remove superseded implementations, CI/report.

## Evidence and decisions

- Clean work/objects fast-forwarded to the unified main baseline. No GIS WIP
  was transferred. Application execution remains prohibited throughout.
- Ruling: preserve this ledger and worktree after implementation; repository
  preservation instructions override skill cleanup defaults.
- Static findings are not measured performance improvements. GUI acceptance
  and full-world performance remain NOT_RUN until separately authorized.

## Verified slices

- The original Qt-free `native/core` source now lives in `shared/core`; the app
  retains its `Pandoeditor::Core` target. The standalone native and Emscripten
  builds consume these sources. This relocation by itself does not migrate the
  Web document or whole-project Undo owner.
- Native `core_session_tests`: 1/1, bounded non-GUI fixture. The latest separately
  compiled `project_codec_tests` and `document_session_tests` pass 2/2. Actual
  compiled WASM session/document checks pass 4/4, including the original 68
  record validation inputs, exact month-end resolution, atomic invalid load,
  no-op revision, document Undo/Redo, dirty and stale candidate epochs. These
  checks cover the currently admitted basic commands, not all UI commands.
- Web timeline integration uses an ordered dedicated Worker and the compiled
  C++ session. Fourteen small frozen Web read models preserve every field and
  coordinate. Whole-document commands/history are still being moved and are
  not counted as completed.
- Native reference calculations now bundle the canonical root Web JS sources,
  with eight obsolete source copies removed. The deterministic esbuild runtime
  and manifest checks pass; calibration/trace/refinement fixtures cover 13
  cases without changing their expected outputs.
- Native active geometry resources are generated from the canonical root Web
  calculation sources and a hash manifest. Sixteen current cut modules,
  normalization and river calculation resources share their actual source; the
  previous active duplicate resources are removed. Historical fixed oracle
  sources and corpus are preserved separately. Generator checks pass, including
  2/2 source/artifact tests and the focused historical adapter checks.
- A standalone QtCore/QJSEngine `current_geometry_tests` executable verifies
  clipping area, long-edge subdivision, river metadata/area, one complete
  recorded cut result and cancellation with the actual current resources. It
  passed without the editor, Qt Quick engine, map scene or large world data.
- Native build admission checks those source hashes before compiling the
  reference resource. The three bounded source/runtime tests pass, including
  a configure/build-only miniature target that rejects an edited canonical JS
  source. No application is built or launched by that fixture.
- QtCore/QJSEngine-only calibration checks run all seven original fixtures with
  exact JSON comparison: 7/7. A separate comparison with the baseline runtime
  from `9300609` also runs 7/7, with no regression or contract difference. No
  application, window or Qt Quick engine is instantiated.
- Pages staging synthetic checks: 6/6. Shared C++ and native sources are
  excluded; missing required JS/WASM/manifest blocks publication. No real
  deployment was performed.
- Shared build/ABI/codec change classification: 5/5. Known shared headers and
  the actual native startup/render/selection boundaries have explicit owners.
  Unknown shared domain
  sources remain an error instead of being silently skipped. Unified source
  and evidence checks: 11/11, including an untracked sibling `shared/` mutation
  invalidating a native build receipt.

The first QtCore calibration harness incorrectly passed QVariant-wrapped arrays
instead of the production JSON.parse boundary. Its failing output is not a
product discrepancy. The corrected harness uses the actual production argument
encoding and passes without changing the product, geometry or golden values.

An early historical timeline fixture helper generated the full current world
while preparing its tests. That invocation exceeded the intended small-fixture
scope and failed six RPC harness cases. It is not counted as a full-world pass.
The helper now uses 60 synthetic classifier endpoints (300 coordinates) plus
the small historical entities; the bounded corrected checks pass 10/10.

## Current review and remaining work

- Startup preparation, lightweight bounds, prepared scene adoption and async
  hydro admission are implemented. A review caught a current-generation stale
  revision leaving `worldStatus=preview`; it now reaches the existing failure
  boundary. Obsolete generations still discard silently. Static guards and
  provenance checks pass 10/10; changed worldbootstrap syntax-only compile
  passes. These checks do not measure a running app.
- Build provenance is finalized only after a successful link and includes the
  executable hash. Configure-only and failed builds cannot approve an old EXE.
  The six canonical reference JS sources are part of source identity. A further
  bounded negative test verifies every source mutation is rejected even before
  regenerating runtime. Existing recovery snapshot mismatch handling is retained
  as a pre-existing limitation, not silently changed.
- Independent codec review found shortest-number representation thresholds,
  native escaped lone-surrogate behavior and duplicate opaque/typed capital or
  flag ownership. The small native codec test covers 14 Qt number tokens and
  duplicate opaque ownership. A separate QtCore text-policy test covers six
  string tokens, exact raw token preservation and duplicate keys created by
  native surrogate replacement. Native Qt UTF-8 and Web UTF-16 parsing policies
  are explicit platform inputs; valid Web lone surrogates are not silently
  replaced. These tests pass without changing their expected values.
- Actual Web Worker document checks exposed two integration failures: a single
  rename returned nine object updates, and an unrelated rename lost an explicit
  `itemVisibility.hydro[id]=false`. Both were reproduced and corrected without
  weakening expected values. Fresh native session tests pass 3/3 and actual
  Document Worker checks pass 2/2: complete seed, one-object delta, preserved
  visibility, Undo/Redo, dirty, saved checkpoint, no-op, failure and cancellation.
  The
  native current format separates river/lake wire groups; canonical item
  visibility uses `hydro`, while layer visibility retains river/lake groups.
- Actual Worker selection/export checks also pass 3/3: all 30 frozen Web
  selection transitions, selected object/builtin history states and full seed
  export. A file-save acknowledgement using an old export epoch is rejected,
  leaving the current file dirty. Autosave acknowledgement intentionally does
  not call the explicit file-save `markSaved` transition.
- Frozen current Web history/selection and 23-step draft traces preserve the
  observable rules. Changed Undo/Redo clears all selection; no-op Redo preserves
  it; unrelated hover remains. Beginning even an unmoved vertex drag creates a
  draft checkpoint in the current Web behavior. These observations guide the
  common core and are not replaced by existing native behavior.
- The pure C++ `GeometryDraft` target passes the actual frozen 23-step Web
  trace, including selected vertex, input phase, insert target, history/future,
  queued drag and exact revisions. Native/Web caller activation remains in
  progress, so this is core evidence rather than a completed UI workflow.
- The native draft callers now consume that shared `GeometryDraft` and have no
  second writable geometry/history class. Ordinary coordinate history stores
  only the edited path and container dimensions; untouched islands/rings are
  not copied into every coordinate checkpoint. Whole-object translation or
  replacement still uses full snapshots. Tiny multipolygon Undo/Redo and
  replacement/translation cases pass; eight affected translation units pass
  syntax-only compilation. This does not establish full-world memory use.
- Fresh actual Document Worker checks pass 13/13 after the month admission,
  atomic cursor/selection acknowledgement and same-session draft bindings.
  These include fourteen month read models, the 30 selection and seven history
  transitions, four territorial field cases and the 23-step draft trace with
  bounded history. Atomic two-object batch checks separately pass 2/2, including
  cancellation and a failing second action with no partial document change.
  The old `Worker.unref()` test helper caused pending zero-timeout RPC checks
  to be cancelled before assertions; explicit Worker disposal now owns its
  lifetime. Those cancelled attempts were not parity passes.
- Current Web territorial notes compare the raw input before trimming it. Both
  general and regional repeat-whitespace edits therefore create a history
  checkpoint and advance state revision even when stored notes stay equal.
  The frozen oracle reproduces this quirk; shared commands preserve its narrow
  scope. True normalized no-op and a second empty general name remain no-ops.
- Native typed selection/history caller syntax checks pass for eleven changed
  app translation units and the selection probe. The source-boundary checks
  pass 4/4. Native GUI test expectations were updated but those tests were not
  executed. Current empty-selection project reset retaining a range anchor is
  preserved and separately identified as a pre-existing Web quirk.
- Web oracle independence was first checked with 47 test-only original blobs from
  `9300609`. Their recorded blob IDs were compared with that Git tree: zero
  mismatches. SHA-256 and Git blob SHA-1 are verified before import; the helpers
  do not call the new production core facade. The added opaque flag42 mutation
  trace records edit/no-op/Undo/Redo from that actual original implementation.
  The label creation/deletion dirty-lane trace extends that original closure to
  51 blobs. Automatic label settings belong to content history and do not mark
  presentation dirty; explicit visibility dirty survives content Undo. The
  common owner is being updated from this actual token/history evidence rather
  than comparing all presentation fields to their saved values.
- The persistence service consumes an asynchronous `{project, checkpoint}`
  receipt, writes only the project body and awaits acknowledgement. Cancelled
  or stale results cannot publish a new project's saved status. A device write
  followed by checkpoint failure cannot trigger a second fallback write. The
  service/recovery/timing checks pass 29/29; superseded forwarding alias removed.
- Preview cache checks pass 9/9. Asynchronous geometry is awaited, with project
  epoch checks before creating a Worker or publishing a result after delayed
  storage reads. The old late-read path was reproduced starting a Worker after
  cancellation and corrected. The first RED harness used an incorrectly timed
  microtask and timed out at ten seconds; the corrected explicit creation/read
  barriers reproduce the error without sleeps or a timeout.
- A remaining cold hydro viewport check no longer hashes source content on the
  owner thread. It consults the existing verified-file receipt owner; a cold or
  invalid receipt schedules the existing asynchronous verifier and checksum
  retry/download policy. The dedicated non-GUI QtCore/Network/Concurrent test
  passes 1/1 (0.46 seconds), with tiny local payloads and no application. Static
  startup checks pass 8/8; the affected controller passes syntax-only compilation.
  The regression test caught a temporary-file rename invalidating the verified
  change-time identity. Installation and promotion now verify the final cache
  path on the worker before publishing readiness. Same-size edits with restored
  mtime and replaced files remain rejected; verification is not omitted. The
  first configure lacked MinGW's DLL path and was corrected with command-local
  PATH, without changing system settings.
- Reference-image draft application now awaits the real same-session command.
  The bridge checks pass 4/4, covering the reproduced Promise-as-false and
  unhandled-rejection paths. Actual controller operation boundaries pass 10/10
  for acceptance, decline, duplicate submit, replaced/redrawn preview and
  rejection diagnostics. A late acknowledgement cannot close a new preview.
  These are small non-DOM operation checks, not installed browser/Qt UI tests.
- Independent actual WASM Unicode checks preserve all six loaded name/notes
  cases through storage and export. Additional ID checks exposed long lone
  surrogate replacement in typed read models and selection accepting IDs that
  the original Web rejects with `URIError`. The failing artifact had source
  digest `2e85c0080e27ae4261b814ac9c03217ecf8ded210ba29aad6e26ed7796693c74`;
  storage/export remained exact. The corrected actual artifact passes all 39
  checks including flag metadata and Unicode ID cases, with source digest
  `436fd18dbf7fdd803a98d35a9d5ae0033020b5464780585e6d04fac00343ff42`.
  Read-model strings preserve lone UTF-16 units; only the original selection
  key admission rejects them with `URIError`.
- Pure C++ project codec extraction, all-domain typed commands, whole-project
  history/dirty, selection and edit-draft ownership migration remain in progress.
  The basic document session is tested; live activation, atomic multi-domain
  commands and removal of superseded Web writers are not yet complete.
- Web/native selection conversion now has a distinct domain/type/id reference
  boundary. A selection's type and territorial display kind are separate; the
  native QML kind callers have been updated together. Native hover uses the
  shared selection owner; the duplicate controller field has been removed.
- The approved historical portability pin remains unchanged. Updated path
  correspondence is a candidate, not evidence of an approved clean-commit
  corpus. No expected values or existing differences are auto-approved.
- Actual app responsiveness, first rendered screen, large world behavior,
  browser UI, native UI, remote CI and deployment remain NOT_RUN.

## Latest bounded integration checkpoint

- The independently admitted frozen Web corpus now includes 55 original blobs.
  The actual original generic/distribution/label/hydro writer trace records 21
  checkpoints, including empty-import history, raw-input/no-op distinctions and
  the original state-revision clocks. These are original implementations, not
  new facade implementations used as expected values.
- Native content codec and command checks pass 2/2. Actual current Web runtime
  IDs such as `G`, `L` and `E` remain literal. Existing load/save UUID admission
  is a different boundary and remains strict; selection fixtures are not
  rewritten to hide runtime identity differences.
- Actual Worker content/draft checks pass 6/6, and the draft/render/hover slice
  passes 29/29, on compiled source digest
  `a49a04a99d0599b55a0a5778753ed76c3fb7039df935ecb3493b4ff4c1ebb737`.
  Sources continue to change; this digest is evidence of that slice, not the
  final current worktree or a packaged runtime.
- Generic and distribution production facades now dispatch typed Core commands
  and consume the immutable accepted before/after projection. Their focused
  transport/result checks pass 18/18. A later actual service trace caught an
  unsupported-field public error-code difference. The facade preserves the
  original uncoded public Error and retains the Core coded error as its cause;
  the next matching compiled artifact must confirm that fix.
- The ordinary segment-hover failure was reproduced in a tiny native draft
  fixture. Hover remains allowed before insert mode is enabled; bounds checks
  remain. The focused native regression passes and the latest 29 Worker checks
  include the previously failing hover behavior.
- The active JavaScript selection reducer was removed. Core owns selection,
  anchors and hover sources; the Web module is an immutable projection.
  Eleven focused transport/UI acknowledgement checks pass, plus twelve actual
  Worker selection/identity and existing view-state checks. Three actual Worker
  frame/reset/disposal checks pass. These are not browser or Qt UI tests.
- Invalid non-null hover was reproduced clearing a valid hover accidentally.
  The public adapter now distinguishes invalid references from explicit null;
  the actual Worker regression passes without changing null-clear behavior.
- The new literal-ID public 30-step selection fixture exposed two remaining
  creation boundaries: copying nonempty source details into a new label was
  rejected by conservative provenance admission; then a valid new label exposed
  a duplicate geometry-version update in the accepted read-model path. These
  failures remain recorded while the responsible Core and projection owners
  correct them. They are not counted as completed selection parity.
- Actual constructor-array metadata and newly created provenance admission,
  territorial structural commands, live whole-document composition, storage
  wiring and final source-matched runtime packaging remain in progress. No
  whole-project completion, full CI pass or running-app performance is claimed.
- The map-controls oracle closure now contains 58 admitted original blobs. Its
  ten original view transitions verify independent names/flags/master visibility,
  repeated identical view requests after file save, fixed boundary width and
  preservation of current labels visibility. The production map facade dispatches
  Core view intents, waits for acceptance, checks project generation and then
  performs the existing presentation effects. Three held-acknowledgement checks
  and scoped lint pass; the exact actual-WASM view comparison awaits the next
  matching compiled artifact.
- A repository-wide caller search found the two layer-list visibility setters
  had no production callers after the flat object-search change. Both writers
  and their exports were deleted instead of introducing unused shared variants.
  Active admission/pruning callers remain part of the load integration work.
- The accepted read model now treats an identical re-admitted geometry version
  as the same immutable archive allocation. A reproduced duplicate-key failure
  is fixed; changed coordinates under the same version or duplicate delta rows
  still fail atomically. Focus/mixed-range checks then pass 19 of 20; the remaining
  public 30-step failure is the original ignored-hover-clear no-op metric.
  Core, rather than a second UI hover source, supplies that acknowledgement
  classification. Its new runtime pair has not yet been counted as verified.
- A later coherent Core build passes five focused native targets in two seconds,
  including the new exact current-Web territorial command corpus. The matching
  actual WASM artifact has source digest
  `ee1a63195b786349e283378b043af7bb8a8d6650c120173827a32572c4f2b0ad`.
  Thirteen focused actual Worker checks pass in 2.77 seconds: all 30 public
  selection snapshots and metrics with literal IDs, focus/range behavior,
  invalid hover, primary deletion clearing all selected items/anchors, same-ID
  recreation followed by range, and metadata-array load/edit/export/Undo.
  The earlier selection no-op metric and duplicate-delta failures are closed
  for this artifact.
- Original current Web constructors, schema validation and storage preparation
  accept distribution metadata arrays with UUID IDs. This is not an unsaved
  alpha-ID exception. The shared codec now preserves the same arrays, including
  nested source-reference annotations and null elements; no field exclusion or
  conversion to an empty object was used to obtain the passing result.
- Exact map comparison exposed visibility-only controls normalizing the entire
  layer presentation in the original Web. The new control intent correction is
  source-landed after that artifact; its next actual runtime must verify the
  exact full presentation result. This remains an open slice.
- Independent native review found remaining native plan/mode/content/undo
  routing outside the new Session. Native migration is now explicitly active;
  relocation alone is not counted as complete common behavior. The reference
  image library is a separate global media/calibration store, not a second
  writable Project copy, and remains a platform resource owner.
- Progressive startup admission now goes through the ordered Core project
  boundary. Preview and canonical territorial replacement use scoped sources,
  retaining current header/content/display data; saved documents use full
  admission. No active JavaScript Store restore/replace or model normalization
  remains in that startup module. Matching current fixture tests and scoped
  initializer publication are still being connected.

## Bounded reproduction

Build `core_session_tests`, `project_codec_tests`, `document_session_tests`
and `geometry_draft_tests`
from `shared/` with one compile job, then run only those CTests with a ten-second
limit. Build the WASM target with pinned Emscripten 4.0.20 and run
`shared/tests/wasm-session.test.mjs` and `shared/tests/wasm-document-session.test.mjs`.
The packaging tool rejects
source/ABI/compiler/runtime mismatches and does not refresh approved corpus pins.

The reference check is independently buildable from
`native/tests/reference-runtime/CMakeLists.txt` with Qt Core and Qml only. Its
default CTest compares the exact current Web calibration fixture. Supplying
`PANDO_REFERENCE_BASELINE_RUNTIME` runs the separate before/after regression
comparison while still reporting all Web contract differences.

The current geometry check is independently buildable from
`native/tests/current-geometry/CMakeLists.txt`, using a freshly built shared
core library through `PANDO_CORE_LIBRARY`. The text policy check is independently
buildable from `native/tests/json-text-policy/CMakeLists.txt` with Qt Core only.
All standalone builds use one compiler job and bounded CTest timeouts.
The receipt-only admission test is independently buildable from
`native/tests/verified-file/CMakeLists.txt`, requiring Qt Core, Network and
Concurrent. It uses small local files and localhost fixed-response fixtures.
