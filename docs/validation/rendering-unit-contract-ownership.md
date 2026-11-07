# Rendering unit contract consolidation

Scope: the Web Viewer render pipeline, WebGL GPU resources, Canvas fallback,
renderer and mesh Workers, terrain runtime and terrain build/verification.
Owner branch: `work/optimization`. This is a test-only migration; it does not
change geometry, rendering calculations or artifact publication.

## Ownership rules

- **Render scene / presentation**: frame identity, current-request admission,
  visual order, stage/commit and first-frame readiness. A ready country frame
  must never depend on optional DEM completion.
- **WebGL and mesh resources**: draw preparation and upload are distinct from
  actual draw; LOD/byte budgets, GL context ownership, shader lifecycle,
  SDF joins/caps, selection/picking and resource cancellation stay observable.
- **Canvas**: asynchronous bitmap acceptance, synchronous Canvas2D fallback,
  geographic projection and terrain display remain separate backend contracts.
- **Workers**: RPC cancellation, worker-thread transfer, revision supersession
  and immutable worker-asset packaging remain separate kinds of evidence.
- **Runtime DEM**: manifest admission, LOD selection, visible uploads,
  terrain frame publication, source-limited readiness and raster fallback.
- **Generated DEM**: native/GDAL/Python pixel parity, source pins, output
  hashes, polar/date-line gutters and safe destination paths are never
  replaced by a synthetic browser-only fixture.
- **Performance**: unit policy (DPR, hysteresis, scheduling) is distinct from
  controlled browser performance measurements and their provenance.

## Shared test facilities

Introduce reusable minimal scheduling ports for queued/aborted Worker jobs
and reusable GL allocation/retirement counters. Keep fixture ownership
local to each test and do not replace real dependency semantics with source
code string extraction when a stable public seam exists.

## Migrations and invariants

Original unit contract names survive via `// Original feature contract:`
markers in the surviving owner files. Avoid merging unrelated Core/WASM/GDAL
native prerequisites into a single test process. Track every retired path
through workflow, package script, and application-check catalog references.
Only original tests whose behavior is obsolete and unreferenced may be
replaced with an explicit retirement contract; never silently delete unique
failure-path, parity, lifecycle or rendering contracts.

The original 616-contract identity baseline and current branch file
inventory are independent of test file count. Full Node/CI/Playwright/native
execution is deferred by project decision until all consolidation areas
have been processed; code changes do not imply passing tests.
