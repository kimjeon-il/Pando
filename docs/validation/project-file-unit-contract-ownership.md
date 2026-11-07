# Project, GeoPackage, file and library unit contract migration

Branch: `work/optimization`. Baseline: 471 root unit tests on `dd4e0da49cc2`.
This document records the ownership boundaries for the P0–P7 consolidation.
Current Viewer product is the supported browser application; historical
editor/Windows behavior is not re-enabled by these tests.

## Contract owners and prerequisites

| Area | Owned contracts | Must remain independent |
| --- | --- | --- |
| Project creation / serialization | `project-creation-contract`, `project-serializer`, `project-setup` | Initial bounds and BCE month parsing do not require native file encoding |
| Project state / lifecycle | `project-state`, `project-lifecycle`, `project-domain-core-command` | Actual Core acknowledgements and rollback/dirty checkpoints, not JS-only reducers |
| Viewer file access | `file-access-contract`, `project-product-surface` | Real browser File selection / cancel / read-only surface |
| Default preview and topology | `project-preview-policy`, `project-preview-topology` | Native Core topology prerequisite must be retained if combined |
| GeoPackage | `timeline-geopackage`, `core-gpkg-file-boundary` | Actual SQL/WASM file bytes, error codes and same-epoch Core spatial receipts |
| Core save and replacement | `core-project-*wasm`, `core-document-*wasm` | C++ / WASM prerequisite inherited from original suite identities |
| Library runtime / Git | `library-data*`, `library-content`, `library-storage` | Immutable originals, Git object conservation, unexpected worktree edits, real HTTP auth |
| Library automation | `library-auto-*` | Worker-only policy may share tests; actual publication, network, GitHub auth and workflow guards remain independent |
| Library report publication | `library-report-*` | Partial push, retry, original vs. private edits, remote byte verification |
| Tooling / QGIS / GIS import | `shared-toolkit`, `qgis-*`, `import-*` | Native QGIS service and GIS geometry math are separate boundaries |

## Convergence strategy

P0 establishes this matrix; P1 consolidates project creation and state fixtures;
P2 consolidates Viewer file-access and project preview where dependencies match;
P3 consolidates Core/WASM save, load and restore, keeping GPKG byte oracles
independent; P4 consolidates library revision and scope policies without
merging direct Git/HTTP execution; P5 unifies library automation policy and
retains publication evidence; P6 reuses current command/project/file fixtures,
removing only verified dead legacy assumptions; P7 updates explicit test
references, prerequisite inheritance and contract identities.

Preserve `// Original feature contract: NAME.test.mjs` markers. Every
original contract must still map to one active file even when that file is
not executable alone without its original Core/WASM/Git prerequisite.
The command planner resolves these identities to the current physical
file. Do not merge separate native prerequisites merely for file count.

Required negative paths: invalid GPKG or schema never mutates a live project;
replacement failure restores exact previous Core/history/selection; an
in-flight save cannot mark a newer edit clean; no library source, report
original, Git object, current worktree or publication candidate is silently
discarded; no cross-repository publishing or app-main integration occurs
through this unit-only migration.

Unit/CI/native/Playwright execution is deferred until consolidation across
all areas finishes, per user instruction. A committed source change is not a
claim of passing checks.

## P0–P7 applied migration (unit count 471 → 459)

P0 recorded the domain ownership boundaries in this document. P1 kept
project initialization and serialization in `project-creation-contract`.
P2 moved Viewer read-only domain gates into `file-access-contract` and
Core-assisted preview topology assertions into `project-preview-policy`.
P3 consolidated project admission/replacement/save in
`core-project-file-save-wasm`, original C++ content/draft contracts in
`core-document-wasm`, and production GeoPackage byte and same-epoch Core
projection assertions in `timeline-geopackage`. The generic-feature Web
oracle still initializes at module scope before synchronous Node suites.
P4 paired library source scope with expected remote revision checks in
`library-data-scope`. P5 paired automation request/workflow policy with
`library-auto-sync` and Toolkit report ownership with `shared-toolkit`.

P6 introduced isolated fixture ports `portability-project-seed.mjs`
(always returns a fresh detached project input) and
`report-git-fixture.mjs` (local-only Git and report writes). Existing SQL,
C++ Core, immutable archive and browser file ports were retained.

P7 updated explicit `package.json`, workflow and check-catalog entries.
The compiled Core/WASM check keeps its original prerequisite; its GPKG
suite now runs through `timeline-geopackage`. The bounded library publisher
job continues executing the same policy contracts through the current file
without scheduling retired suite names. No published library bytes,
repository data pins, Native tools or production application code changed.

The 12 retired suite entrypoints remain listed as original contracts via
`// Original feature contract:` markers in nine active owner files.
The unit-file count was read from GitHub's actual unit-test tree, and
explicit references in the 72 workflow files, 74 script files, package
scripts and the application-check catalog were inspected. This was static
review only: Node tests, lint, CI, browser and native validation were **not**
executed under the user's deferred-validation instruction.
