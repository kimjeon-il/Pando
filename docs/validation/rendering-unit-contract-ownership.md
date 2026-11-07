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

## Applied P0–P7 migration

- P0: codified owner and backend/native boundaries in this document.
- P1: `overlay-mesh-engine` joined `render-scene`; `gpu-prepared-draw`
  joined `gpu-base-scene-order`.
- P2: `renderer-v2` joined `gpu-stroke-renderer`. Streamed boundary
  segments and C++ country stroke-group parity joined the existing
  `gpu-mesh-country-strokes` harness; `gpu-country-mesh-variants` remains
  independent from that spherical Core fixture.
- P3: Canvas DEM vertex/texture behavior joined `canvas-country-geometry`;
  latest-job scheduler tests joined `worker-rpc` and use the shared
  deferred-result test port.
- P4: `terrain-manifest` joined `physical-layer-service`; upload response
  and immutable-frame policy joined `terrain-interaction-streaming`.
- P5: source-window raster-native, output hash and Windows-only path safety
  remain standalone, as those cases have different native prerequisites and
  are called by distinct focused workflows. `terrain-dem-check` owns DEM
  level and verifier-CLI checks; DEM fill has one native/fallback contract;
  terrain preview build/grid/CLI and audit/source-pinning are grouped separately.
- P6: adaptive quality and label-shell frame policy joined `startup-performance`;
  the real-hardware performance evidence contract stays standalone. Common
  GL buffer allocation/deletion ports and asynchronous scheduling ports are
  reused without changing the underlying production code.
- P7: updated affected workflow, package command and application-check input
  paths. Native preparations, platform-specific paths and Core/WASM evidence
  remain independent. Moved fixture top-level awaits to module scope rather
  than putting asynchronous setup into synchronous Node test-suite callbacks.

The unit test file count for this migration is **488 → 471**, with original
contract labels preserved in their owning suites. Static source/registration
inspection does not establish runtime success: Node, CI, Playwright, WebGL and
native validation have explicitly **not** been executed during this phase.
