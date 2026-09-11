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

## Geometry and view ownership

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
