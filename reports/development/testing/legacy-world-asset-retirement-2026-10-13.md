# Retire unreferenced historical world preview assets (2026-10-13)

> Report ID: `DEV-068` · Status: `cleanup implemented / targeted CI required` · Production map data: `unchanged`

## Baseline and decision

- Base: unified `Pando/main` commit `468561893639017e272cdcfb91b911e6309a091d` (Web 0.36.0; Native pinned world 0.33.0).
- The user directed dependency validation and deletion of unused large files, repairing broken references first. This is a **specific four-version deletion**, not a blanket authorization to remove archived GIS assets.
- Checked `main`, `work/ui`, `work/objects`, `work/gis`, `work/places`, `work/auto-georef`, `work/hydro-names`, and `tmp/fetch-north-schleswig-west`: all use the `world/current.json` runtime loader at product version 0.36.0. Active Web bundle `world/build-input.json` selects `world-preview-v0.36.0.json`. Native provenance `native/assets/world/manifest.json` fixes world preview and canonical inputs at v0.33.0.
- The immutable territory baseline fixture also pins `countries-canonical-v0.35.0.pcg.gz` and `world-preview-v0.35.0.json`, retained. Current content-addressed world assets, shared country boundary data `countries-*-shared-v0.34.0.json.gz`, 334 raster tiles and current Hydro remain intact.

## Exact deletions

| Version | Deleted set | Tracked bytes |
| --- | --- | ---: |
| 0.30.0 | preview countries, preview mesh, world-preview manifest | 2,581,788 |
| 0.31.0 | preview countries, preview mesh, world-preview manifest | 2,581,788 |
| 0.32.0 | canonical packet, preview countries, preview mesh, world-preview manifest | 7,711,901 |
| 0.34.0 | canonical packet, preview countries, preview mesh, world-preview manifest | 7,788,370 |
| **Total** | **14 tracked files** | **20,663,847** |

The explicit version suffixes above match these paths under `assets/data/`: `countries-preview-v<version>.geojson.gz`, `world-mesh-preview-v<version>.bin.gz`, `world-preview-v<version>.json`, and `countries-canonical-v<version>.pcg.gz` only where present.

## Dependency repairs and checks

- `tests/unit/renderable-outline.test.mjs`: load current v0.36.0 country preview instead of v0.30.0. The boundary assertions and test expectations are unchanged.
- `tests/unit/mesh-geometry-assets.test.mjs`: validate current v0.36.0 preview mesh instead of removed v0.32.0. The canonical mesh, full numeric assertions and original expectations are unchanged.
- `tests/browser/startup-interaction-gate.spec.mjs`: derive both canonical request intercepts from the current content-addressed world manifest, rather than dead fixed versioned URLs. Repair the obsolete input fixture: hover must not block current background loading, so the test holds an active pointer from the `pandolab:interactive` event until the movement loop ends, then checks the same 500 ms quiet-window admission. Browser CI is required for acceptance.
- A targeted GitHub Actions gate checks immutable live/native pins, absence of all retired paths, and current geometry/outlines with the original unit assertions.
- Startup browser assertion records the *first* canonical packet admission; the forced network abort can legitimately generate subsequent retry requests. It still requires **zero canonical requests during active pointer input** and the original minimum quiet-window interval after release.
- Previously published legacy version URLs may return HTTP 404 under `docs/data-url-retention-policy.md`. Historic files are recoverable from the exact pre-removal Git commit; no history rewriting or force pushing is performed.

## Scope exclusions

The Web fallback raster `assets/data/terrain/v0.12.6/`, current Hydro `assets/data/hydro/v0.13.2/`, GIS import GDAL WASM and DATA, and Native offline bundle are required. They cannot be deleted without redesign. Research/reference images, human-readable reports, source GIS and frozen fixtures are deliberately preserved. Identical Git blob hashes shared with retained paths do not yield the same saving in Git's on-disk object store as the nominal 20,663,847 bytes removed from checked-out/current Pages trees.

## CI and deployment

Merge only after the focused integrity gate passes. Existing full CI / behavioral parity failures are separate baseline issues and are not represented as fixed by this cleanup. Update the result using the post-merge GitHub Actions and Pages evidence.
