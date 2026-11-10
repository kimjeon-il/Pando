# Project-common LOD implementation

Approved scope: preserve current vector sources and saved project format; defer LSIB
ingestion and T_NE/T_min calibration. Work only on work/gis; no main integration or deployment.

1. Synchronize the permanent GIS worktree, preserving its library pin; capture a real baseline.
2. Extend the existing shared-arc LOD owner with exact identities and optional calibrated
   meter policy, monotonic protected topology, and explicit bounded failure handling.
3. Fit fixed project bounds at relative zoom 1; support continuous 1..32 in both projections;
   preserve the camera on date changes and publish the scale/LOD frame contract.
4. Consume identical display geometry in WebGL/Canvas; keep picking canonical and visible
   selection boundaries on the accepted display geometry.
5. Reuse numerical DEM and stored shade, unify land mask/color composition, then remove
   replaced map-preview consumers, generators, and mandatory asset contracts.
6. Run focused geometry, camera, renderer and browser regressions and before/after metrics;
   publish the selected rendering report, commit/push work/gis, and clean task scratch.

Implementation progress and exact check results are recorded in the task-owned ignored
`.library-data/task-work/project-common-lod/progress.md`; completed research/evidence goes
to `reports/development/rendering/project-common-lod-2026-11-10` in the library.
