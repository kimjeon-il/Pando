# Worker and edit pipeline

This document records the runtime ownership used by the fourth rendering refactor. It is intentionally narrower than a general Worker pool design.

## Worker roles

| Worker | Role | Scheduling contract |
| --- | --- | --- |
| `map-edit-worker` | Stateful canonical country edit authority for merge, annex and new-country transactions | One dedicated Worker, one running job, latest queued job per logical key, explicit commit/discard |
| `canvas-render-worker` | Stateful fallback renderer with terrain and hydro caches | Dedicated renderer Worker; view messages already use latest-frame backpressure |
| `hydro-tile-worker` | Stateful hydro package/cache and logical-feature service | Dedicated streaming Worker; view generation rejects old tile responses |
| `data-loader-worker` | Stateful boot pipeline coordinating canonical geometry and packaged meshes | Dedicated startup Worker with phase cancellation |
| `gpu-mesh-worker` | Stateless triangulation and country mesh packet generation | Bounded caller-side scheduler; same patch key is latest-wins and stale revisions never swap buffers |
| `geometry-validation-worker` | Stateless project validation | Dedicated on-demand instance with request cancellation; a shared pool is unnecessary at its current frequency |
| `label-anchor-worker` | Stateless label anchor calculation | Dedicated lazy Worker; request IDs reject stale results |
| `river-territory-partition-worker` | Stateless but infrequent planar subdivision | Dedicated on-demand Worker with generation/signature validation |
| `gis-geometry-worker` | Transaction-scoped GIS validation and geometry preparation | Dedicated import Worker owned by its import transaction |
| `gis-gpkg-worker` | Stateful heavy GDAL runtime | Dedicated runtime Worker; never mixed into lightweight geometry scheduling |

Increasing Worker count is not a performance objective. Stateful Workers remain isolated, while only independent jobs use bounded latest-wins scheduling at their caller.

## Revision contract

Interactive asynchronous work carries four values:

- `requestId`: unique scheduler request.
- `jobKey`: logical replacement key such as `map-edit:annex` or `mesh:country-overrides`.
- `geometryRevision`: the canonical geometry snapshot used by the calculation.
- `targetRevision`: the application or renderer revision allowed to accept the result.

The caller applies a result only when both revisions are current. For one `jobKey`, at most one running request and one queued successor are retained. Superseded running work may finish inside its Worker, but its result is discarded and cannot update canonical state or GPU buffers.

## Edit flow

```text
pointer move
  -> session-only typed-array EditPreview
  -> GPU interaction repaint

pointer up
  -> structured geometry and topology validation
  -> one canonical mutation and one history entry
  -> affected-country optimistic overlay
  -> latest country patch mesh job
  -> atomic GPU override swap
```

Map navigation and object selection do not enqueue geometry work. A valid previous mesh remains visible until the latest patch is ready. The preview packet is not serialized and never changes project history.

## Deferred to phase five

- authoritative/display LOD policy across all overlay domains
- adaptive quality based on device and measured frame budget
- generalized stateless Worker pool sizing
- mobile memory-pressure cache budgets
- renderer packet compression beyond the existing typed-array/transfer paths
