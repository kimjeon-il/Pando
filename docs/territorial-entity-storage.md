# Unified territorial entity storage

## Approved execution

Base: `2091ee2c294df237d844e32f9b926449677c45e4` (remote main checked 2026-10-06).
Branch: `feat/unified-territorial-entity-storage`. Existing checkouts, ignored outputs,
and App repository remain untouched. No main merge or deployment is authorized here.

The approved M0–M16 sequence unifies reusable territorial data under one source
file per entity, preserves the current packed world rendering path, and loads
individual geometry files only on demand. Schema/temporal and identity tests,
source migration, library/chunk loading, canonical parity, persistence, retirement,
and performance are gates in that order. Do not proceed past a relevant failure.
Unrelated pre-existing failures are recorded separately rather than refactored.

Decisions: catalog kind remains `general|regional`; catalog IDs and project logical
IDs are separate domains. No identity merges without an explicit mapping, invented
founding dates, new historical geometry, coordinate rewriting, legacy readers, or
dated editing UI. Project schema 9 / timeline records 1 and `TIMELINE_ACTIVATION`
remain unchanged. Old Yugoslavia ends **1992-04-26**, new Yugoslavia starts
**1992-04-27** (user correction supersedes the earlier planning answer).

## M0: baseline ownership and paths

- `data-loader-worker.js` reads `world-preview-v${APP_VERSION}.json`, loads
  preview countries/mesh/labels together, then receives `start-geometry` to fetch
  canonical PCG. Canonical application acknowledgement triggers mesh loading.
- `canonical-country-packet.js` owns the packed source and cooperative materialization;
  `app-builtin-session.js` installs it and creates fresh built-in classification.
  Natural Earth has 258 features; classification uses stable subunit UUIDs and
  explicit source IDs. Do not rename these project identities to catalog IDs.
- `historical-library.js:createCurrentCountryLibraryEntities` builds
  `current-country:*` wrappers from current root features. The service combines
  these with 26 pilot entities. Pilot recipes are materialized using pristine
  canonical geometry, polygon clipping, and the production clipped normalizer.
- `selectGeometryVersion` currently sorts matching candidates by start year and
  selects a nearest-year fallback outside coverage. The new catalog must reject
  ambiguity and return null outside covered lifetime/geometry periods instead.
- The library stores names, parentLibraryId, startDate/endDate, instantiation,
  metadata, sourceInfo and geometryVersions; some existing versions are explicitly
  approximate successor-country unions. Freeze existing production results and
  preserve this provenance; do not claim them as newly verified historical borders.
- `territorial-entity-store.js` owns live static project mutations. Identities,
  `timelineRecords.lifetimes`, `geometryBindings`, `parentRelations`, and the
  immutable archive in `geometry-version-store.js` are the project sources of truth.
  `timeline-storage.js` already supports complex records; live editor restoration
  validates them and gates activation before publishing anything.
- `build-world-preview.mjs` and `build-world-mesh.mjs` currently read Natural Earth
  directly. Preview uses existing topology simplification. Canonical encoder takes
  unchanged source geometry and properties; shared boundary builder derives
  signatures/segments after existing built-in classification.
- Existing commands include build/check preview, mesh, country schema, shared
  boundaries, historical library, UI bundle, metadata, unit/Python/browser tests.
  The baseline runs each existing test group once without short-circuiting later
  groups. Later gates run only affected checks/builds.

## Evidence and completion ledger

M0: complete for the agreed affected baseline. Raw command outputs and fixed baseline materialization live in
ignored `node_modules/.cache/territorial-storage/`. These are execution evidence, not a
replacement test framework. No baseline success is claimed until commands finish.

M1–M16: not started.

Baseline observations (2026-10-06): full units **1702 pass / 0 fail / 0 skip**;
lint, JS syntax, version, source country schema and UI checks exit 0. The historical
library check exits 0 and confirms 26 entries. Production baseline materialization
is fixed as 258 canonical countries and 29 geometry versions across 26 historical
entities; hashes include the temporal contracts, source assets and packed outputs.

The initial Python invocations could not execute because Python was absent from
PATH. Using the already installed Python 3.12 (Shapely 2.1.2 / pyproj 3.7.2), root
Python tests are **247 pass**. DEM test collection remains unexecuted because
`rasterio` is unavailable; no unrelated dependency was installed. Architecture
execution reached the Python boundary; its JavaScript groups passed. The missing
Python versioning test and remaining worker/renderer/domain/startup groups were
then run separately and each exited 0; the original architecture failure is retained.

The user stopped the 303-case browser run after an unrelated `color-swatch-layout`
timeout and authorized the affected library/canonical/startup/timeline subset.
Initial focused baseline: 9 pass / 5 fail / 0 skip. All five failures were stale
fixtures: retired asset URL, pre-adaptive DPR assumption, old mesh vertex count,
world-scale canonical LOD assumption, and missing await/retired finite activation
expectation. The actual current contracts retain activation atomicity, reviewed
East Prussia geometry, cache repair, and preview/canonical canvas identity.
Corrections: 3 pass / 2 fail / 0 skip (old vertex constant), then the remaining
2 pass / 0 fail / 0 skip using the current manifest header. All 14 affected cases
now have passing evidence; no full browser pass is claimed.

Execution infrastructure correction: the first runner wrote into Playwright's
output directory, which Playwright clears at startup. That interrupted evidence
collection. The runner was stopped, logs moved outside that directory, and only
incomplete groups restarted. Completed lint was not repeated. Interrupted browser
cases are not represented as successful execution evidence.

Performance gate: same machine/browser/viewport/DPR, baseline and candidate three
runs each, cold/warm cache separated. Compare startup/decode/memory medians and
pan/zoom p95, scene preparation and upload. More than 5% regression fails the gate;
startup territorial-index/chunk requests must be zero and geometry diff must be zero.

Final report must separate changed/new/deleted files, schema, same storage path,
multi-version evidence, canonical/lazy-load paths, parity, command counts, builds,
performance, and remaining work, and freeze the final candidate SHA.
