# Worldwide historical shoreline workflow — event-based pilot

**Status:** GIS research / prototype contract, **not** production runtime integration.  
**Started:** 2026-10-09.  
**Branch:** `work/gis`.  
**Mandatory rules:** [historical reconstruction policy](historical-border-reconstruction-policy.md), [branch/worktree policy](branch-policy.md).

## Netherlands pilot — closed at 1:10M research scope (2026-10-28)

The nine-event Dutch **date/source catalogue** and one compact historical shoreline report remain the evidence owners. Prioritize Zuiderzee/IJsselmeer, Wieringermeer, Flevoland, and major waterway connections. Treat local harbor fills, separate small artificial islands, dyke microchanges and subpixel shoreline differences as omitted by default unless they change an important state, city, island, or major physical connection.

The previous 12-point probe and expanded area-receipt JSON have been removed from the current archive; the 36,029-vertex comparison and 0.5 CSS-pixel number are legacy research context, **not** current acceptance criteria. A legacy numeric field may remain in the retained event-source metadata, without establishing coastline accuracy. Their high-detail conclusions are condensed in the dated report; old Git revisions retain historical records. No historic shoreline vectors were created, and the present NLD geometry, country timeline, hydro data and map are unchanged. Event construction and closure dates are not dates of land formation or proof of historical ownership.

## 1. Objective and non-goals

Build historic shorelines across multiple centuries **without storing one full coastline for every country-year**. Reuse a modern baseline wherever the historical shoreline is unchanged, and store independent **geographic change events** tied to dated evidence, physical effects, and local geometry.

Select events that change the macro shoreline or explain the existence, attribution or important connections of states, major cities and important islands. Match presentation detail to **Natural Earth 1:10,000,000 (1:10M)**. Normally omit minor deposition, erosion, river-mouth shifts and seasonal water-level/flow changes; record the scope omission briefly without reconstructing each occurrence. Explain any historically important small exception. The display target does not supply a uniform positional accuracy or deletion distance.

This method is a **working design**, not a claim that historical shorelines are automatically reconstructable. The review must not replace genuine period maps with modern coastlines, assume that natural erosion is reversible from engineering documents, or infer ownership from a coastline.

Event inventories are reusable across sovereigns and eras: Germany 1914 coastal change and postwar Dutch reclamation are **geographic events**, even where the present-day country is different.

## 2. Existing canonical owners: do not duplicate

- **Current national source geometry:** `assets/data/territorial-entities/source/countries/<lineageId>.json` and the existing territorial build pipeline. Generated bundles are **not** authoritative editable source.
- **German regional event evidence:** `tools/historical-library/sources/german-coastline/change-events.json` and the detailed WMS / dyke / Helgoland evidence alongside it. Do **not** copy those entries into another 'global' country-specific table.
- **Dutch dated event evidence:** `tools/historical-library/sources/netherlands/change-events.json` and the [condensed historical Netherlands report](https://github.com/kimjeon-il/PandoLab-library-data/blob/main/reports/borders/reconstruction/netherlands/land-reclamation-reverse-timeline.md). Retired baseline probes and individual area/vertex receipts are not historical shoreline sources or publication prerequisites.

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
3. **Independent period evidence:** choose dated maps and contemporary engineering GIS sufficient to establish the selected major change. No detailed source scale is mandatory; consult finer sources only for a concrete important question. Check the relevant land/water extent and construction phase without tracing every minor water-edge bend. Map layer range must not be mistaken for exact sheet year.
4. **Working vectors:** reconstruct the principal local before/after `land` and `water` geometry, preserving originals, master geometry, source hashes and GCP residual. Assign only supported validity intervals. Unknown exact transition dates remain unknown.
5. **Topology:** verify the island existence, waterway connections, marine/inland water classes, shared edges and territorial ownership needed to explain the selected event. Generalization must not introduce invalid geometry or unintended gaps/overlaps.
6. **Presentation review:** compare a separate generalized derivative with the Natural Earth 1:10M reference at the same extent, projection and display magnification. Stop when the selected event’s date, attribution, recognizable form and necessary topology are supported. Maximum app zoom is only a technical inspection aid, not a demand to reconstruct finer history. Independent period-line measurements are optional and must be distinguished from visual review; point-to-modern-shore measurements do not establish historical accuracy.
7. **Derivative materialization:** first add a local verified patch to an **isolated historical geometry version**. Build and test derived meshes/snapshots. Preserve original/master geometry and share unchanged shoreline arcs. Do not overwrite the modern original or automatically move a historical state's legal boundary. This policy does not direct regeneration of existing assets or changes to renderer/mesh accuracy checks.
8. **Release:** Web/App provenance and affected tests reviewed separately; only integrate into `main` with explicit approval.

## 5. Geographic and temporal rollout

Use overlapping spatial packages **rather than a separate full audit for every country**. The first pilot packages are:

- **Netherlands:** Zuiderzee/IJsselmeer, Wieringermeer and Flevoland first; review Lauwerszee and IJsselmeer/Markermeer connectivity only when visible at 1:10M. Rotterdam, Zeeland, Dollard and smaller fills are exceptional only where a major coastline or waterway change is demonstrated, not a mandatory high-resolution rollback.
- **1914 German Empire:** continue existing coastal event list and historical WMS, North Frisian levees, Helgoland and Schleswig land/sea boundary; **do not treat large Natural Earth vs HistoGIS differences as confirmed reclamation**.
- **Shared Dollard/Ems:** one physical shoreline investigation with *separate* bilateral frontier evidence and sovereignty interpretations.

Use event checkpoints, not synthetic 1-year snapshots. Prioritize major changes and missing important coastal components at the Natural Earth 1:10M presentation level, with period evidence. Minor numerical differences do not require further reconstruction; small changes affecting a selected important exception remain reviewable with a recorded reason. Preserve the existing pilot inventory and its observed results rather than claiming they have been revalidated under this policy.

Remote sensing and modern national GIS can **locate recent candidates**; it cannot create trustworthy pre-1980 global shoreline vectors on its own. Evidence gaps affecting selected major events remain explicit limitations. Minor natural geomorphology and undocumented river-mouth shifts are normally outside reconstruction scope unless an important exception is identified.

## 6. First-pilot observed facts and limitations

The 2026-10-27 [condensed audit report](https://github.com/kimjeon-il/PandoLab-library-data/blob/main/reports/borders/reconstruction/netherlands/land-reclamation-reverse-timeline.md) records the earlier NLD baseline observation: 12 national polygon components (nine European, three Caribbean), inland water included in the country footprint, and an unverified Maasvlakte 2 sample outside the then-published outline. Neither a country containment sample nor subtraction of the bundled lake area proves actual dry land or a missing historical reclamation.

The retained [nine-event source catalogue](../tools/historical-library/sources/netherlands/change-events.json) preserves source references and established construction/closure dates without inventing shoreline geometry. The former point-probe JSON and individual high-detail audit JSON have been retired; their historical findings are included in the compact report.

**Future work, only if a major event warrants it:** independently verify time-specific land and water before/after shapes for the selected 1:10M-visible event. No automatic Rotterdam rollback, full coastline digitization, country replacement or Web/App change is authorized by this pilot.

**Deliberately unchanged:** canonical country source, preview and mesh, built-in lakes/hydro data, other histories, app repository, `main` and live application.
