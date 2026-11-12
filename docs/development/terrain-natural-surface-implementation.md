# Natural-surface B implementation plan

Status: implementation in work/gis; no main merge, deployment, or operational pin change.
Spec: user-approved Pando_B_natural_relief_implementation_spec_2026-11-12.md (2026-11-12).
Base: b6a1981495db2928c326ec0278d9ff6f8f55e968; latest main bd4ce107179da483bbfbad64036ef400adaeda66 is already an ancestor.

## Goal and architecture
Add optional, unshaded natural-surface WebP tiles to the existing B DEM tile pipeline. Assets live only in kimjeon-il/PandoLab-library-data. Immutable Git revision, byte length and SHA-256 validation must match existing terrain fetch behavior. Preserve LUTs, alternate-theme bitmaps, visible tile selection and current fallback terrain.

## Constraints
- Existing physicalLand determines geometry; source imagery never edits coastlines.
- Natural color is used only in physical/colored land; political/monochrome and ocean remain unchanged.
- Original float32-derived hillshade is applied once; no baked topographic illumination.
- Same source imagery for light/dark; no network request just because theme changes.
- NASA BMNG Base Map first representative source; WorldCover, RGI and polar masks remain separate offline input/adoption tasks. NASA-only previews are not completed land-cover or permanent-ice products.
- No COG/PMTiles/Float16/atlas redesign. No global full-resolution production before representative validation.
- Do not label Canvas interpolated sampling complete until actual display path and bounded CPU/memory checks pass.

## Tasks
1. RED/GREEN asset contract: validate partial natural tile catalogs against DEM grid; produce version-pinned URLs; reuse fetchTerrainTile bytes/hash checks; skip missing, ocean, monochrome and hidden-terrain requests.
2. Representative generator: explicit pinned NASA Base Map input, regions only, shared cell registration/gutter, opaque RGB WebP and source/hash/date receipts; preserve original DEM bytes. Store candidate and source receipts on library work/gis; verify remote readback.
3. Optional WebGL integration: use existing DEM demand and upload ownership, lower priority natural loading, shared budgets, generation guards, incremental redraw and palette fallback. Do not delay terrain readiness for surface imagery.
4. Canvas integration: preserve exact existing LUT output with surface absent, mix unshaded surface before original shade, invalidate both theme images on surface content change; numeric subpixel rendering remains a separate completion gate.
5. Focused browser and numerical regression: actual external tile fetch, wrong hash/size, cancellation/late delivery, missing coverage, texture teardown, monochrome no-fetch, theme reuse and baseline byte parity.

## Review focus
Missing/corrupt natural data must not remove DEM; new manifest must not reuse old images; nature cache must not evict required DEM; history must not imply historical snow/vegetation; source-water conflicts must fall back rather than alter geometry.

## Implementation ledger
- Planning: source/spec and branch state read; no local user worktree is accessible from this session. Changes use the connected remote work/gis branch and scoped CI, without creating another user workspace.
- Scope of first candidate: data/loader foundation plus representative source validation. Any remaining renderer, land-cover, permanent-ice or measured-performance work must be named in the result rather than treated as complete.
