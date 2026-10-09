# Worldwide historical shoreline workflow — event-based pilot

**Status:** GIS research / prototype contract, **not** production runtime integration.  
**Started:** 2026-10-09.  
**Branch:** `work/gis`.  
**Mandatory rules:** [historical reconstruction policy](historical-border-reconstruction-policy.md), [branch/worktree policy](branch-policy.md).

## 1. Objective and non-goals

Build historic shorelines across multiple centuries **without storing one full coastline for every country-year**. Reuse a modern baseline wherever the historical shoreline is unchanged, and store independent **geographic change events** tied to dated evidence, physical effects, and local geometry.

This method is a **working design**, not a claim that historical shorelines are automatically reconstructable. The review must not replace genuine period maps with modern coastlines, assume that natural erosion is reversible from engineering documents, or infer ownership from a coastline.

Event inventories are reusable across sovereigns and eras: Germany 1914 coastal change and postwar Dutch reclamation are **geographic events**, even where the present-day country is different.

## 2. Existing canonical owners: do not duplicate

- **Current national source geometry:** `assets/data/territorial-entities/source/countries/<lineageId>.json` and the existing territorial build pipeline. Generated bundles are **not** authoritative editable source.
- **German regional event evidence:** `tools/historical-library/sources/german-coastline/change-events.json` and the detailed WMS / dyke / Helgoland evidence alongside it. Do **not** copy those entries into another 'global' country-specific table.
- **Dutch regional event evidence:** `tools/historical-library/sources/netherlands/change-events.json` and the previously prepared [reverse-chronological source plan](../tools/historical-library/sources/netherlands/netherlands-land-reclamation-reverse-timeline.md).
- **Read-only Dutch current-baseline point audit:** [phase-0 result](../tools/historical-library/sources/netherlands/phase0-canonical-audit.md). Neither this audit nor the nine indexed events contains a digitized historical shoreline.

Worldwide catalogue discovery now starts from the [read-only coastline catalogue registry](../tools/historical-library/sources/coastline-catalogs.json). It references German and Dutch regional source catalogues by **path and geographic scope**, without copying events. A future loader may consume this registry; no production loader or current-world build has been changed.

## 3. Conceptual separation

| Layer / fact | Owner / future representation | Example |
| --- | --- | --- |
| Geographic event | One geographic event ID, date evidence and source citations | 1932 Zuiderzee barrier closure |
| Land–sea geometry | Local time-dependent **land addition/removal** vector patches | Maasvlakte 2 fill |
| Inland water geometry | Separately dated water-body outline changes | IJsselmeer and Markermeer water surfaces |
| Waterway connectivity | Graph or reviewed connected/disconnected barriers | Afsluitdijk, Houtribdijk and Lauwerszee |
| Sovereignty / subunit ownership | Country/territorial timeline, independent of physical event | German–Dutch Dollard/Ems boundary |
| Rendered country shoreline | **Derived** period-specific presentation geometry | 1914 coastline for a selected state |

A `MultiPolygon` with no interior holes can contain physical inland water. Thus **country membership does not prove dry land**. Testing only a point in a national polygon cannot establish whether an artificial island was drawn in a separate lake mask.

The coastline base, water masks and ownership timelines must be reconciled at the same reference date; an unverified physical event should **not** silently update any of them.

## 4. Evidence states and promotion gates

Follow the existing GIS policy's `source-indexed`, `overlay-reviewed`, `screen-delta-checked`, `historically-verified` and `provisional` vocabulary.

1. **Index:** event ID, neutral geographic site, candidate interval, distinct construction / closure / drainage/opening dates, source URL, source survey and publication/revision years, licensing, and explicit uncertainty. `geometry.status = not-digitized`; no geometry modification.
2. **Screen modern baseline:** test the **actual current canonical shape and hydro source**, not country names or live browser overlays alone. Mark full region coverage as present / absent / uncertain based on independently sourced footprints; point tests only establish sampled membership.
3. **Independent period evidence:** choose official dated maps (often around 1:25,000) and contemporary engineering GIS; independently check water edge, dike crown, tide flat, silted foreshore, basin, lake and construction phase. Map layer range must not be mistaken for exact sheet year.
4. **Working vectors:** trace local before/after `land` and `water` geometry, preserve originals, source hashes and GCP residual. Assign only supported validity intervals. Unknown exact transition dates remain unknown.
5. **Topology:** verify island creation/merging, lake-open-sea links, closure barrier topology, marine/inland water classes, shared boundary edges and country's territorial ownership before any date-specific promotion.
6. **Screen delta:** use Web maximum `flatZoom=64`, map width `2560 CSS px`, independent period coastline digitization, *bidirectional* projected-line maximum separation **≤0.5 CSS px** where measurable. Any meaningful territorial, connectivity or date error overrides this threshold. Point-to-modern-shore measurements **do not qualify**.
7. **Derivative materialization:** first add a local verified patch to an **isolated historical geometry version**. Build and test derived meshes/snapshots. Keep unchanged shoreline arcs shared. Do not overwrite the modern original or automatically move a historical state's legal boundary.
8. **Release:** Web/App provenance and affected tests reviewed separately; only integrate into `main` with explicit approval.

## 5. Geographic and temporal rollout

Use overlapping spatial packages **rather than a separate full audit for every country**. The first pilot packages are:

- **Netherlands:** Maasvlakte 2 modern baseline → phased Rotterdam rollback; then Zuiderzee/Wieringermeer/Flevoland water/land/connection chronology → Lauwerszee / Zeeland / Dollard.
- **1914 German Empire:** continue existing coastal event list and historical WMS, North Frisian levees, Helgoland and Schleswig land/sea boundary; **do not treat large Natural Earth vs HistoGIS differences as confirmed reclamation**.
- **Shared Dollard/Ems:** one physical shoreline investigation with *separate* bilateral frontier evidence and sovereignty interpretations.

Use event checkpoints, not synthetic 1-year snapshots. Prioritize large map-visible deltas and missing coastal components using the **actual** current max-zoom review and period maps. Small numerical differences are not reasons to dismiss component ownership or changed waterways.

Remote sensing and modern national GIS can **locate recent candidates**; it cannot create trustworthy pre-1980 global shoreline vectors on its own. Non-event natural geomorphology, historical shoreline survey gaps, and undocumented river-mouth shifts remain explicit exceptions.

## 6. First-pilot observed facts and limitations

As of 2026-10-09, the built-in NLD source contains **12 polygons, of which nine are European and three Caribbean, with no interior rings**. The [12 point probe](../tools/historical-library/sources/netherlands/canonical-phase0-probes.json) found 11 points inside this **country** polygon, including sample inland water locations, and one point (a published Maasvlakte 2 locality) outside. This is a canonical baseline sample, **not** a coastline inventory, hydrology audit or independently digitized historical screen-delta check.

A separate Dutch [nine-event physical catalogue](../tools/historical-library/sources/netherlands/change-events.json) now uses the existing German pattern, with official source references and no invented shoreline switch dates.

**Next promotion blocker:** obtain date-specific modern/pre-reclamation coastal vectors for one genuinely local patch (recommended Maasvlakte 2), and verify the current rendered baseline first. No rollback geometry, historical-polygon replacement or actual Web/App source change has yet been performed.

**Deliberately unchanged:** canonical country source, preview and mesh, built-in lakes/hydro data, other histories, app repository, `main` and live application.
