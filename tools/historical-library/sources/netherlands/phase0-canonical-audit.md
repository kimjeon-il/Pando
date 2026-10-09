# Netherlands shoreline pilot — Phase 0 canonical baseline probe

**Status:** measured **national-polygon sample coverage only**; shoreline and hydrography reconstruction **not started**.  
**Checked:** 2026-10-09 on Web `Pando` branch `work/gis`.  
**Source:** Canonical source: `assets/data/territorial-entities/source/countries/nld.json` (repository root relative).  
**Canonical geometry:** `assets/data/territorial-entities/source/countries/nld.json`, entity `state:NLD`, version `state:NLD:natural-earth-5.1.1`.  
**Machine-readable source and regression:** [canonical-phase0-probes.json](canonical-phase0-probes.json), `tests/unit/historical-netherlands-coast-phase0.test.mjs`.

## 1. What was actually checked

A read-only point-in-MultiPolygon probe was run directly against the checked-in canonical NLD coordinate array, not a screenshot. The geometry has:

- **12 component polygons:** 9 in European Netherlands, 3 in the Caribbean, and **0 polygon interior holes**;
- no independent, period-specific historical line as part of this check;
- 12 hand-selected location probes, 11 inside the country polygon and 1 outside.

With the **current project flat-map normalization** (`flatZoom=64`, `2560 CSS px`), the published approximate Maasvlakte 2 location ([Wikidata place coordinate](https://www.wikidata.org/wiki/Q2733197), **3.9833°E, 51.9583°N**) falls outside the canonical NLD country outline. The nearest-boundary distance calculated against its vertices/segments is about **15.63 CSS px**. This is **not** an independent historical coastline difference, nor proof that the *whole* Maasvlakte 2 is absent. Dated 2010/2013 coastline polygons are still required.

All point positions other than the published Maasvlakte 2 point are **manually chosen approximate checkpoints**, not survey coordinates and not a test of the event footprint. A pass/fail against a sample is *only* about whether that particular point lies inside this country polygon.

## 2. Baseline point results

| Probe | Sample lon, lat | National polygon | What this does **not** establish |
| --- | --- | --- | --- |
| Maasvlakte 2 | 3.9833, 51.9583 | **outside** | Complete 2013 landfill outline or shoreline |
| Maasvlakte 1 control | 4.05, 51.96 | inside | Complete earlier port footprint |
| Noordoostpolder | 5.73, 52.70 | inside | 1942 shoreline or Urk connection |
| Oostelijk Flevoland | 5.56, 52.47 | inside | 1957 polder shoreline |
| Zuidelijk Flevoland | 5.26, 52.36 | inside | 1968 polder shoreline |
| Wieringermeer | 5.02, 52.82 | inside | 1930 shoreline or polder enclosure |
| IJsselmeer water | 5.25, 52.85 | **inside** | Whether the water is actually dry land |
| Markermeer water | 5.25, 52.55 | **inside** | Lake geometry, lake separation or flood connectivity |
| Marker Wadden candidate | 5.37, 52.59 | inside | Whether separate artificial islands are depicted |
| IJburg candidate | 5.01, 52.36 | inside | Whether phase-specific IJburg islands are depicted |
| Lauwersmeer water | 6.22, 53.38 | inside | 1969 closure shoreline or remaining open-water geometry |
| Braakman candidate | 3.63, 51.35 | inside | Whether the historical inlet existed |

The NLD national polygon covers large inland water areas. Therefore **point-in-country must never be used as a land/water, lake, artificial-island or polder-presence classifier**. It is only a first-pass *outer national footprint* check. The existing built-in lakes/hydro source requires a **separate** current-versus-historical review.

## 3. Dated event catalogue created

[change-events.json](change-events.json) records **nine** source-indexed physical events: Amsteldiepdijk (1924), Wieringermeer (1930), Afsluitdijk (1927–1932), Noordoostpolder (1942), Oostelijk Flevoland (1957), Zuidelijk Flevoland (1968), Lauwerszee closure (1969), Houtribdijk (1963–1976; 1975 closure) and Maasvlakte 2 (2008–2013).

All nine events are **`source-indexed` + `not-digitized`**. Sources and engineering/closure/drainage *dates* have been indexed; none has a verified dated coastal polygon, verified epoch-specific water mask or quantitative historical-screen Hausdorff comparison. In particular:

- Rijkswaterstaat dates the **Zuiderzee's final barrier closure to 1932-05-28** and the main polder dry years to 1930, 1942, 1957, 1968.
- Rijkswaterstaat dates **Lauwerszee closure to 1969-05-23**.
- Rijkswaterstaat dates **Houtribdijk gap closure to 1975-09-04**, with construction continuing to 1976.
- The Port of Rotterdam identifies **2013** as the Maasvlakte 2 opening; this is **not** necessarily the date every reclaimed area first became land.

Official primary-source URLs are recorded under each event's `sourceIds`. Unindexed checklist events remain in the [reverse timeline plan](netherlands-land-reclamation-reverse-timeline.md), not silently converted to verified geometry.

## 4. Implications for the general worldwide scheme

1. **Do not rewrite a country's full coast per year.** Store independently sourced events and actual date-validated local polygon/line changes.
2. **Separate national ownership, dry land, inland water and waterway connectivity.** A national polygon cannot stand in for all four; barrier closure may alter connectivity without creating the full land polygon.
3. **Never interpret a completed engineering project as an exact global polygon switch** unless source-based topology and waterline classification are established. Event intervals and exact hydraulic closure dates have different fields.
4. **Do not double-count cross-border features.** The Dollard/Ems sector must be cross-referenced to the existing German coast event inventory without copying the same reconstruction under two sovereigns.
5. **Preserve the 0.5 CSS px project rule** for independent historically dated geometry at 2560 CSS px and max flat zoom 64. Component identity, ownership and water topology are non-negotiable even at smaller differences.

## 5. Next physically correct geometry work

**First target: modern Maasvlakte 2 extent vs 2010 and 2013 dated coastlines.** The outside-point result suggests the canonical current outer coast may miss material modern fill at this location. Before generating rollback patches:

1. Obtain a reference-year modern extent from [PDOK Sea Regions coastline](https://www.pdok.nl/ogc-apis/-/article/zeegebieden) / TOP10NL and [Kadaster Topotijdreis](https://www.topotijdreis.nl/); review dataset date, CRS and ODbL/CC-BY provenance as appropriate.
2. Confirm whether the *actual web-rendered* NLD outer polygon, built-in lake mask and coastline display include the modern filled land; a point sample alone cannot certify that.
3. Trace and validate a complete modern footprint and a dated pre-fill outline **separately**. Only then derive a local proposed change with explicit land/water and port-basin semantics.
4. Compute independently sourced, projected **bidirectional** shoreline separation (not the place-to-boundary measurement above), test geometry validity, unchanged adjacent sectors and relevant topology, and publish a provenance record.
5. Keep the present world, German 1914 provisional working shape, original coastline input, and all user projects untouched until a specific verified patch passes.

After the modern port experiment, use Zuiderzee/Flevoland to test **hydrography and disconnected-island** transitions. Treat broad waterfront changes of Germany/Netherlands as *linked evidence*, not independent country-by-country edits.

**Out of scope here:** any Web/App runtime changes, generating 1914 Netherlands polygons, integrating the global event schema into production, changing official hydro files, historical Hausdorff verification or merging to `main`.
