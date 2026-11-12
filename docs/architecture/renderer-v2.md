# Renderer v2

Renderer v2 is the canonical map rendering contract. It keeps canonical project geometry independent from presentation quality and uses one GPU device for the map scene, boundaries, selection and edit previews.

## Pipeline

```text
Project Model
  -> Worker preprocessing / geometry packets
  -> immutable RenderScene
  -> MapRenderCoordinator dirty masks
  -> one RenderDevice / one WebGL context
  -> ordered GPU passes
```

The runtime pass order is defined by the actual coordinator and GPU renderer behavior. Architecture-only expectations live in `scripts/lib/renderer-v2-architecture.mjs`; no declarative test contract is downloaded by the browser.

The map mode supplies the land substrate: theme land color without terrain, grayscale relief in monochrome mode, and terrain tint/shading in physical mode. Country and territorial materials contain only explicitly assigned or inherited paint. Missing paint and disabled color leave the substrate visible; clearing a color does not persist a gray replacement. The country palette keeps paint alpha and geometry visibility in separate rows so transparent paint does not disable picking, boundaries, or selection. WebGL and both Canvas paths consume the same territorial fill resolver.

## Geometry and view ownership

### Common dependency rule

Dates, view changes and project generations trigger evaluation, not blanket
resource disposal. `resource-update-policy.js` is the pure shared decision
owner. Resource owners supply source/content keys, preparation conditions,
the actual graphics context and its generation, and presentation conditions.
It reports input, CPU preparation, GPU upload and presentation changes.
Classic Canvas workers load a generated adapter built from this exact module;
the adapter has no separately maintained policy implementation.
An owner retains its own keys and resources; no global resource-state mirror
or element-specific date/project exceptions are permitted.

Temporal lifetime/property/geometry queries still run. Compare their effective
results before scheduling work. Equal country geometry and membership retain
the complete mesh, shared strokes and spatial blocks. A name/color/flag change
updates the dependent presentation, while unchanged hydro packs, terrain,
land/water geometry, place data and asset bytes remain resident. Context loss
requires device reconstruction only. Existing budgets and explicit eviction
still apply; a missing result must be prepared even when its dependency key
matches an evicted entry.

Use verified content hashes or immutable geometry references within their
source namespace. Copied allocations and unrelated global revisions do not
establish changes. Hash new geometry at its admission/revision boundary, not
on every date or frame. Stale completions may populate a matching immutable
cache but cannot publish a newer view. Selection, drafts, user edits and
history retain their existing project replacement semantics.

Canonical GeoJSON remains lossless. Render LOD is derived only for cached render packets and never writes back to project geometry. Geometry caches are keyed by geometry revision, LOD and projection. Pan, zoom and rotation update frame uniforms; a view-only render must not trigger scene triangulation, stroke topology rebuilds, or mesh compilation.

`RenderScene` is immutable and revisioned. Geometry-heavy country mesh work remains Worker-compiled and transferable. New expensive CPU geometry preprocessing should use Worker RPC instead of introducing another request protocol.

## Shared GPU stroke renderer

All map-like strokes use `gpu-stroke-renderer.js`. Selection is not allowed to create a second canvas or WebGL context.

The stroke contract is:

- widths are CSS-pixel based on desktop and mobile;
- geometry stays in geographic coordinates and is projected in the vertex shader;
- connected segments carry previous/current/next topology;
- open chains have terminal cap nodes; closed chains have joins only;
- round joins/caps are GPU node primitives;
- miter joins use neighboring projected directions and a miter limit;
- bevel triangles fill non-round outer joins and act as the miter-limit fallback;
- stroke edges use shader coverage anti-aliasing instead of relying on device-pixel overdraw;
- view changes never rebuild the stroke topology buffer.

Country boundary owner ranges remain scoped so selecting one country never draws unrelated boundary nodes.

## Context and fallback policy

`gpu-map-renderer.js` owns the only `RenderDevice`. Selection and polygon/stroke passes receive shared renderer resources from that device. SVG/DOM remain appropriate for labels, vertices, handles and HUD controls; map geometry should not migrate back to SVG as a performance fallback.

Canvas Worker remains the non-WebGL fallback and is intentionally a specialized persistent worker. It consumes the same canonical project state and revision model rather than becoming a second business-state owner.

## Guardrails

`pnpm check:renderer-v2` verifies the single-context rule, shared stroke renderer, connected topology and analytic AA markers, immutable RenderScene cache contract, view-only coordinator mask and Worker mesh transferables. It is part of `pnpm check:architecture` and therefore CI.


## RenderDevice-owned GL state scope (P0, 2026-11-12)

`render-device-state.js` is the context-generation owner for the GL state
required by hydro coverage and shared stroke coverage: draw/read framebuffer,
viewport, program, array-buffer binding, active 2D texture bindings, blend
equations/factors, color mask/clear color and enable flags. `RenderDevice.state`
admits the actual state once and follows native GL mutator calls on the shared
context; `capture()` and `restore()` use that ledger instead of calling
`gl.getParameter()` on each coverage draw. `framebuffer()` exposes the
current draw target to the interaction pass without a synchronous readback.

State is scoped to the real GL object and `contextRevision`. A re-created
context must be admitted before reuse, and snapshots from older revisions
cannot be restored. If a platform prohibits method instrumentation, the
state owner must fall back to exact GL snapshots rather than guessing state
or risking a visual regression; the normal Chromium/WebGL1/2 acceptance
requires the tracked path and zero per-coverage driver queries.

Coverage still restores arbitrary incoming GL state (including blend masks
and both framebuffer bindings), not a hard-coded assumed default. The existing
single-RenderDevice and context-loss recovery invariants remain mandatory.
Unrelated synchronous queries in mesh upload scheduling and `gl.isBuffer()`
are independent follow-up work, not part of this GL coverage P0.
