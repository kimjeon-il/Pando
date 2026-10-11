# Complete selected river geometry evidence

This component fixes exactly three actual inventory river groups at Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`, hydro version `0.13.1`, in this order:

- `hydro-system:50766256`: FID 7081, logical FID 2120; one fragment, 36 rendered parts, 218 positions and 36 ordered source reach IDs.
- `hydro-system:50779535`: FID 7096, logical FID 2133; one fragment, 53 rendered parts, 306 positions and 53 ordered source reach IDs.
- `hydro-system:50782443`: FID 7098, logical FID 2135; one fragment, 31 rendered parts, 181 positions and 31 ordered source reach IDs.

All matching baseline fragments were selected and completely decoded: three fragments, 120 parts and 705 positions in total. All three retain role `mainstem`, stage 3 and exact placeholders `미명명 수계` followed by their system ID. Core and detail metadata are preserved separately, together with exact merged metadata and name-field presence. No geographic research name is inserted into these facts. Source reach IDs, river system IDs, logical FIDs and geometry FIDs remain distinct identifier domains.

## Complete local decoding, bounded public facts

The hash-verified production decoder was replayed against the immutable index, core/detail metadata and complete selected shard. FID 7081 occurs in pack 797; FIDs 7096 and 7098 occur in pack 798. Both packs are in shard 2. The published wrapper is original validation code. Third-party production worker, pack and shard bodies are omitted. Previously acquired selected baseline inputs were hash-rechecked locally, with no new external requests.

Complete selected decoded paths remain local verification material and are not redistributed here. `selected-river-metadata.json` records exact baseline metadata, full part counts and per-part coordinate count/digest sequences, full-geometry and feature hashes, bounds, and two whole-fragment endpoints. It contains no per-part endpoint arrays or coordinate arrays. `source-reach-manifest.json` preserves each exact ordered comma-split source-ID sequence and its sorted-distinct union hash. Rendered part count equals source-ID count in each fragment, but independently verified original source-reach coordinate correspondence is not asserted. The complete decoded path is unchanged: no simplification, sorting, repair or reversal.

All three fragments have terminal class `sea`. In each, the retained `sourceEndpoint` differs from its `renderEndpoint`, and the decoded last point agrees with the render endpoint rounded to six decimal places. These are bounded baseline metadata and rendered-path facts. Original continental HydroRIVERS coordinates were not acquired. Source endpoint does not mean a source coordinate independently inspected in this batch. No original-to-rendered coordinate equality, exact original reach-boundary mapping or contemporary shoreline observation is claimed.

`selected-inventory-records.json` contains the three exact original inventory CSV rows, normalized facts and row hashes. `geometry-duplicate-check.json` fixes the previous r09 index's immutable URL at commit `ea66825657b0f7ff8e41616e375bf974cd4dbff1`, byte receipt and all 27 previous awIds in index order. The selected three are mutually distinct and have no overlap with those 27. Prior naming verdicts and old geometries are not rereviewed by this component.

## Rights and acquisition

HydroRIVERS v1.0, HydroSHEDS is the source attribution. See [the official product page](https://www.hydrosheds.org/products/hydrorivers) and [HydroSHEDS technical documentation](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf), Appendix A sections 2.1.2 and 2.2 and Exhibit B. The prior rights assessment did not establish permission for standalone redistribution of selected HydroRIVERS GeoJSON. It remains unestablished. This batch hash-rechecked previously acquired product-page bytes; it did not newly retrieve or reinterpret the license. No complete license-PDF byte hash is claimed.

`geometry-publication-rights.json` preserves that prior assessment and its limits, original product-page hash and acquisition time, and separate local reuse-check time. `geometry-request-receipts.json` keeps original immutable-asset acquisition times separate from local reuse checks. The component publishes factual findings, identifiers, roles, ordering, counts, coordinate digests, bounded endpoint/bounds facts, references and offline validators. It excludes full river coordinates, selected GeoJSON, per-part endpoint arrays, binary packs, upstream worker bodies and raw third-party documents.

## Offline validation

Python 3 is required. Run from this directory:

- `python -B validate-geometry-reference.py`
- `python -B test-geometry-reference.py`
- `python -B validate-geometry-reference.py --check-component-manifest`

Durable-only mode checks published factual tables against fixed canonical pins, exact core/detail metadata and name state, group-versus-fragment joins, ordered source IDs, part counts and digest order, whole-fragment endpoint facts, selected CSV-row facts, prior27 exclusion, pack receipts, provenance and artifact hashes. It cannot independently recompute omitted full coordinates or rehash unavailable original assets. A stored digest is not a substitute for those inputs.

Add `--input-cache INPUT_CACHE` to check named immutable assets, verify the previously acquired product page, replay the production decoder and recompute every selected geometry metric, ordered part digest, metadata record, endpoint and full-feature hash. Node.js is additionally required. Add `--historical-input-root RECOVERED_REPOSITORY_ROOT` to verify original inventory/summary bytes and exact selected rows. Add `--previous-index PREVIOUS_INDEX_JSON` to verify original prior27 index bytes and awId order. Optional inputs are read locally only; no validator fetches anything.

`geometry-validation.json` records successful durable and full-input runs and 24 rejected corruption fixtures. Twenty-three use only the durable component, including altered identities, names, roles, stages, fragment removal, terminal removal, group order, part digest/order/count, source-ID order/duplication, source/render endpoint conflation, changed inventory/prior27/pack facts, unsupported equality/redistribution claims and unexpected public GeoJSON. Modified fixture artifact receipts are refreshed, so fixed pins are exercised beyond receipt mismatches. The full-input fixture rejects an altered production worker before execution or output. Original input hashes are compared before and after tests.

`geometry-component-manifest.json` freezes only this geometry component. It excludes naming research, source-map research, independent review, final results, reconstruction index, queue files, overall package manifest and package validator. This is bounded evidence checking, not geometry repair, a maximal topology audit or live-deployment verification. Geometry and baseline labels alone establish no geographic naming verdict; automatic application remains false.
