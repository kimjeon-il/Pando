# Historical German-coast shoreline change inventory

This directory is an **evidence index**, not a substitute for historical coastline geometry.
Its geographic scope is the coastline of the 1914 German Empire and related
subsequent German-state history, **regardless of the sovereign of each site
when the change happened**. The same event can inform German Empire, German
Reich (1919–1945), postwar and modern maps without duplicating it under each
political owner.

- [`change-events.json`](change-events.json) records dated coastal works and
  an initial map-sheet inventory. Each event cites an independently accessible
  source key from the top-level `sources` object.
- `datedWorks` records the **evidence date**, not an exact time-series polygon
  switch. Construction, dyke closure, port opening and formal completion can
  be different events. Unknown exact switch dates remain `null`.
- An enclosed koog, lagoon, salt marsh, tidal basin or flood-protected lowland
  is **not automatically dry land**. The GIS digitizer must identify the
  relevant land, foreshore, water and engineered connections individually.
- Every currently indexed event is `source-indexed` with
  `geometry.status = "not-digitized"`. The catalogue alone **must not**
  change a country polygon, coastline source, country owner or timeline.
- Map-sheet catalogue years may be edition or publication years, not survey
  years. Geological editions are marked as unsuitable for direct standalone
  shoreline geometry control; none of the listed rasters is georeferenced
  or quantitatively overlaid by this catalogue.

## How to advance a sector

1. Locate the appropriate dated event and its source. Confirm survey,
   revision, construction and closure dates separately.
2. Check one independent period map against the relevant existing working
   coastline. Preserve original source references and original raster/vector.
3. Digitize the **period-specific** coastal geometry in the established
   historical-library workflow, not into this research-only JSON file.
4. Compare at the web flat-map max-zoom 64, width 2560 CSS px, aiming for
   at most 0.5 CSS px against an **independent digitized period boundary**.
   Historical ownership and topological/date errors take precedence over pixels.
5. Once a geometry and time interval are actually validated, update evidence
   and apply only that independently verified patch to the working polygon.
   Do not overwrite the contemporary coastline or another temporal variant.

See [the mandatory GIS reconstruction policy](../../../../docs/historical-border-reconstruction-policy.md).
The current 1914 working polygon continues to contain **provisional modern
coastline sections**. This inventory neither fixes nor conceals that gap.

Focused validation:
`node --test tests/unit/historical-german-coastline-events.test.mjs`
