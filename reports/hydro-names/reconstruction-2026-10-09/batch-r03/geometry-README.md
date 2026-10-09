# Three complete baseline river systems: geometry evidence

This factual audit covers only systems 30624681, 50488324 and 40182409 at Pando commit `fd6744f5e72a0c1a107452dbde6d416ab57237db` (hydro v0.13.1). It does not establish a current deployment or a name verdict.

All nine fragments were decoded from six packs across three manifest-verified shards with the pinned production decoder. Every line part, coordinate, fragment role and source-reach identifier order was retained during inspection. The three systems contain respectively 255, 168 and 255 ordered line parts/source identifiers, and 1,378, 1,436 and 1,406 rendered coordinates including repeated endpoints. System 50488324 contains three mainstem and two tributary fragments; a representative name must not automatically extend to those tributaries.

## Durable files

- `selected-river-metadata.json`: exact identity joins and reconstructed metadata facts, roles, bounded endpoint/bounds facts, complete coordinate counts and geometry hashes
- `source-reach-manifest.json`: all ordered reach IDs, per-fragment sequence hashes and sorted distinct-union hashes
- `selected-inventory-records.json`: the three exact recovered inventory records, used for identity joins rather than name evidence
- `geometry-reference.json`: immutable input pins, selected historical input pins, full-group hashes and explicit verification limits
- `selected-pack-receipts.json`: selected byte ranges and their hashes, with no binary pack data
- `geometry-request-receipts.json`: factual acquisition and reuse records, with original acquisition and later hash-check times distinguished
- `geometry-publication-rights.json`: official product/license links and conservative publication limits

Full river coordinates, selected GeoJSON, binary shards, upstream shapefiles and source maps are not distributed here. The [official HydroRIVERS page](https://www.hydrosheds.org/products/hydrorivers) points to the [HydroSHEDS license](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf), which includes distribution restrictions. This audit does not claim open redistribution permission.

Source: HydroRIVERS v1.0, HydroSHEDS. Lehner and Grill (2013), Hydrological Processes 27(15), 2171–2186, [doi:10.1002/hyp.9740](https://doi.org/10.1002/hyp.9740). WWF has not reviewed this audit or its findings.

## Validation

Run `python validate-geometry-reference.py` in this directory for offline durable-only checks. That verifies published facts, all selected joins, ordered identifiers, roles, fragment coverage, known hashes and artifact receipts. It cannot independently recheck unpublished full coordinates.

For authorized holders of the pinned inputs, run `python validate-geometry-reference.py --input-cache INPUT_DIRECTORY`. That also verifies every required full input, replays the production decoder and recomputes full geometry metrics and hashes. The directory must contain the manifest, compressed index and metadata, all three `shard-sN.bin` files and pinned decoder dependencies named in `geometry-reference.json`. The validator performs no downloads.

An optional `--historical-input-root RECOVERED_REPOSITORY_DIRECTORY` checks the retained priority, inventory CSV and summary file hashes and only the three selected identity records. It does not reassess historical name decisions.

Run `python test-geometry-reference.py` for durable corruption checks. Add `--input-cache INPUT_DIRECTORY` for replay and a modified-decoder rejection check. Python 3 is required; replay additionally requires Node.js. The `geometry-component-manifest.json` lists the frozen component hashes.

## Interpretation limits

Original HydroRIVERS continental shapefiles were not acquired. The per-reach source coordinates, original-reach-to-rendered-part mapping and coordinate equivalence to upstream HydroRIVERS remain unverified. Matching counts of source IDs and line parts does not independently prove reach geometry identity. Decoding establishes the entire immutable rendered baseline group only.

Terminal classes and source/render endpoints are baseline metadata, not contemporary hydrological observations. System 50488324's sea endpoint was altered for rendering. Source endpoint values and the displayed six-decimal endpoint are distinguished. No geometry repair or exact-topology reconstruction was performed. Baseline Korean placeholders are retained as historical metadata; research Korean names remain null and automatic application is false.
