# Included selected lake geometry evidence

This component contains three complete Natural Earth-derived lake features and their selected baseline geometry, in fixed order, at public Pando source commit `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `lakes_base:1159108391`: source ID 1159108391, historical zero-based source index 141, baseline FID 15334, logical FID 3959; one Polygon, one ring, 81 positions including closure; stage 0.
- `lakes_base:1159112839`: source ID 1159112839, historical zero-based source index 457, baseline FID 15650, logical FID 4275; one Polygon, one ring, 45 positions including closure; stage 2.
- `lakes_base:1159112207`: source ID 1159112207, historical zero-based source index 411, baseline FID 15604, logical FID 4229; one Polygon, one ring, 151 positions including closure; stage 2.

Each selected logical target has one included baseline fragment. Source Feature.id is its awId; rendered Feature.id is its numeric baseline FID. These identifier domains remain distinct. The baseline FIDs and logical FIDs apply only to the stated commit.

## Preserved coordinates and factual records

`selected-lake-geometries.geojson` retains the complete selected source feature objects, including their original JSON numeric tokens, properties, rings, and coordinate order. `selected-baseline-rendered-geometries.geojson` retains the complete selected baseline features. Both GeoJSON files are unchanged from the original selected evidence. Every included rendered coordinate equals the corresponding included source coordinate rounded to six decimal places. No coordinate repair, simplification, reordering, or removal was performed.

`geometry-reference.json` records exact ID joins, original source positions as historical facts, bounds, included object hashes, and ordered part/ring/vertex metrics. Included baseline core and detail facts are kept separately and checked against the merged rendered metadata. The source `name` values are `lake-142`, `lake-458`, and `lake-412`; `name_ko`, `name_en`, and `name_original` are empty strings. The corresponding baseline core `name` values are the same placeholders, and detail metadata has no name fields. Empty and absent fields remain distinct. These are identity facts, not geographic name verdicts; automatic application remains false.

`selected-inventory-records.json` contains the three selected factual records and their original CSV row values. `geometry-duplicate-check.json` retains the 33 preceding awIds, the public preceding-index URL, and the bounded current-three count delta. The three selected awIds are mutually distinct and absent from that retained list. The included count facts are 33 to 36 recorded targets and 4032 to 4029 targets absent from fresh reconstruction records, with 3439 river groups and 590 lakes remaining. This is not a count of historically never-researched targets or established names. The pending-access ID `lakes_base:1159112821` is carried separately without reassessment. Prior geometry and naming decisions are not revalidated.

## Historical comparison and present validation boundary

The original source/baseline comparison was performed historically, including selected-fragment extraction and comparison with baseline decoder output. The current public validator checks only the included selected source/rendered features and factual records. It does not re-run the production decoder, check omitted source bodies or decoder dependencies, reconstruct the original full-source membership, or revalidate original inventory, previous-index, or terms-page bytes. Historical source indices and origin findings are retained as facts and checked for consistency, not freshly re-established from omitted inputs.

The reference contains legitimate public repository links for the original lake source, baseline release manifest, and already-published initial inventory. They identify provenance and are not fetched by the validator. Current live deployment equality was neither checked nor claimed. Generalized geometry does not establish an exact modern shoreline or naming scope. Ring closure, coordinate ranges, and bounds are checked; full OGC topology validity is not asserted.

## Rights

Made with Natural Earth. The [official Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) state that its raster and vector data are in the public domain. `geometry-publication-rights.json` retains that fact and the official URL. Only the selected full source and baseline lake features are included. Full upstream assets, binary packs, decoder bodies, and the terms-page body are excluded. No rights are asserted for unrelated research maps or documents.

## Offline checks

Python 3 is required. From this directory run:

- `python -B validate-geometry-reference.py`
- `python -B test-geometry-reference.py`
- `python -B validate-geometry-reference.py --check-component-manifest`

The validator checks included-file hashes, complete selected coordinates, ring and vertex order, original selected source JSON tokens, ID joins, factual metadata and name states, retained selected inventory facts, prior duplicate IDs, and the included current-three count delta. There is no omitted-input replay interface and no network access.

`geometry-validation.json` records one included-evidence validation and 25 bounded corruption fixtures. They cover modified coordinates, order, closure, feature/source/logical IDs, fragment counts and completeness, exact metadata, name states, JSON tokens, ordered ring hashes, historical source positions, selected inventory facts, prior IDs, queue delta, public provenance, rights facts, false live-deployment claims, and reintroduced omitted-dependency scope. Editable file receipts and selected reference fields are rebased where relevant; separate included-evidence pins still reject corruptions.

`geometry-component-manifest.json` pins only this minimized component. Naming research, review, final results, cumulative index, and the overall package remain separate.
