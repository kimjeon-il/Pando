# Prepared boundaries and unified mesh reuse

User-approved scope: follow-up items 2, 3 and 4, with only focused checks.

- [x] Prepare boundary source segments/index/ring directions once; preserve source references and update only changed contacts (one subagent).
- [x] Route overlay fills through the existing spherical mesh engine; reject failed triangulation and preserve holes/dateline/poles.
- [x] Verify projected triangle coverage with independent fixtures, including internal edges and holes.
- [x] Extend the current scene/mesh owners with versioned prepared geometry, static mesh assets and Worker delta preparation.
- [x] Reuse unchanged shapes through metadata, selection and month changes; prevent superseded mesh preparation from publishing.
- [x] Keep Canvas/SVG normalization and boundary preparation outside draw loops; preserve canonical geometry.
- [x] Finish the focused boundary cancellation regression. No full CI, historical source research or deployment.

Native shared-boundary preparation already gathers its segments and spatial index once; change it only if an equivalent repeated preparation is found. Web runtime results do not certify Qt execution.

## Evidence

- Fixed asset producer built 304 unique source/display-scope meshes, including timeline change states; 40,701,211 compressed bytes. Source coordinates remain unchanged. Certified clipping precision discards are recorded in the manifest, rather than hidden.
- Root mesh/cache/scope/transfer/stroke/store unit checks: 55 passed; interaction ownership: 7 passed. Boundary preparation and its direct consumers were checked separately by the single subagent.
- Actual browser checks passed: fixed asset loading without runtime triangulation; edited scene latest-result and style reuse; draft fill Worker preparation and supersession; complete stroke upload staging. WebGL1 fill/stroke shaders compile.
- Independent synthetic concave/hole coverage at 2560 CSS px and flatZoom=64 equivalent scale: globe intrusion 0.113571 CSS px maximum, flat date-line intrusion 0. Shader position error below 0.004670 CSS px. Initial shader drift of about 1.10 CSS px was reproduced with actual transform feedback and removed using a shared precise geographic projection.
- These synthetic rendering results do not certify independent historical borders or Qt execution.
- Changed files linted. Existing shared-boundary asset output remains unchanged. Work stays in the permanent work/objects worktree. The implementation checks exclude full CI and Qt builds; release follows the user's separate commit/push/deploy instruction. Reports and permanent worktrees stay in place.
- Boundary Worker burst regression passed: queued replace/patch/delete requests merge by owner, intermediate responses are suppressed, and only the latest two feature geometries are prepared. Existing prepared indexes survive supersession.
