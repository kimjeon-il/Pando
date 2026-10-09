# Complete selected river geometry evidence

This component fixes exactly three actual inventory river groups at Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`, hydro version `0.13.1`, in this order:

- `hydro-system:50538951`: FID 6821, logical FID 1882; one fragment, 209 rendered parts, 1,038 positions and 209 ordered source reach IDs.
- `hydro-system:50631583`: FID 6900, logical FID 1956; one fragment, 79 rendered parts, 483 positions and 79 ordered source reach IDs.
- `hydro-system:50691033`: FID 6978, logical FID 2022; one fragment, 88 rendered parts, 522 positions and 88 ordered source reach IDs.

All matching baseline fragments were selected and completely decoded: 376 parts and 2,043 positions in total. All three retain the baseline role `mainstem` and the exact placeholders `미명명 수계` followed by their system ID. Core and detail metadata are preserved separately, together with their exact merged metadata and name-field presence. No geographic research name is inserted into these facts. Source reach IDs, river system IDs, logical FIDs and geometry FIDs are distinct identifier domains.

## Complete private decoding, bounded public facts

The actual hash-verified production decoder was replayed against the immutable index, core/detail metadata and complete selected shard. The selected fragments occur in packs 809, 796 and 797 respectively, all within shard 2. The published wrapper is original validation code; the third-party production worker, pack and shard bodies are omitted. Previously acquired baseline inputs were hash-rechecked locally, with no new external requests.

Full selected decoded paths are retained only as local verification material and are not redistributed here. `selected-river-metadata.json` records the exact baseline metadata, complete part count and per-part coordinate count/digest sequence, full-geometry and feature hashes, bounds, and two whole-fragment endpoints. It does not contain per-part endpoint arrays or coordinate arrays. `source-reach-manifest.json` preserves each exact ordered comma-split source-ID sequence and its sorted-distinct union hash. The part count equals the source-ID count in each fragment, but independent source-reach coordinate correspondence is not asserted.

All three terminal classes are `sea`. In every case the retained baseline `sourceEndpoint` differs from its `renderEndpoint`; the decoded last point agrees with the render endpoint rounded to six decimal places. These are retained metadata and render facts. Original continental HydroRIVERS coordinates were not acquired, and the term source endpoint does not mean a source coordinate independently inspected in this batch. No original-to-rendered coordinate equality, exact original reach-boundary mapping or contemporary shoreline observation is claimed.

`selected-inventory-records.json` contains the three exact original inventory CSV rows, their normalized facts and row hashes. `geometry-duplicate-check.json` fixes the previous r07 index's immutable URL at commit `fef2fb3fc52a276fb0059ce66474116de08137d1`, byte receipt and all 21 previous awIds in index order. The selected three are mutually distinct and have no overlap with those 21. Prior naming verdicts are not used as identity evidence or rereviewed by this component.

## Rights and acquisition

HydroRIVERS v1.0, HydroSHEDS is the source attribution. See [the official product page](https://www.hydrosheds.org/products/hydrorivers) and [HydroSHEDS technical documentation](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf), Appendix A sections 2.1.2 and 2.2 and Exhibit B. The prior rights assessment did not establish permission for standalone redistribution of selected HydroRIVERS GeoJSON. It remains unestablished. This batch hash-rechecked previously acquired product-page bytes; it did not newly retrieve or reinterpret the license. No complete license-PDF byte hash is claimed.

`geometry-publication-rights.json` preserves that prior assessment and its limits, the original product-page hash and acquisition time, and a separate local reuse-check time. `geometry-request-receipts.json` keeps original immutable-asset acquisition times separate from current local reuse checks. The component publishes original factual findings, identifiers, counts, coordinate digests, bounded endpoint/bounds facts, references and offline validators only. It excludes full river coordinates, selected GeoJSON, per-part endpoint arrays, binary packs, upstream worker bodies and raw third-party documents.

## Offline validation

Python 3 is required. Run from this directory:

- `python -B validate-geometry-reference.py`
- `python -B test-geometry-reference.py`
- `python -B validate-geometry-reference.py --check-component-manifest`

Durable-only mode checks published factual tables against separate fixed canonical pins, exact core/detail metadata and name state, ordered source IDs, part counts and digest order, whole-fragment endpoint facts, selected CSV-row facts, prior21 exclusion, pack receipts, provenance and artifact hashes. It cannot independently recompute the omitted full coordinates. A stored digest is not a substitute for access to those complete paths.

Add `--input-cache INPUT_CACHE` to check all named immutable assets, verify the previously acquired product page, replay the production decoder and recompute all selected geometry metrics, ordered part digests, metadata, endpoints and full-feature hashes. Node.js is additionally required. Add `--historical-input-root RECOVERED_REPOSITORY_ROOT` to verify original inventory/summary bytes and exact selected rows. Add `--previous-index PREVIOUS_INDEX_JSON` to verify the original prior21 index bytes and awId order. Optional inputs are read locally only; no validator fetches anything.

`geometry-validation.json` records successful durable and full-input runs and 20 rejected corruption fixtures. Nineteen use only the durable component, including altered identities, names, roles, part digest/order/count, source-ID order, source/render endpoint conflation, changed inventory/prior21/pack facts, unsupported equality/redistribution claims and an unexpected public GeoJSON. Modified fixture artifact receipts are refreshed, so fixed independent pins are exercised rather than only receipt mismatches. The full-input fixture rejects an altered production worker before execution or output. Original input hashes are compared before and after the tests.

`geometry-component-manifest.json` freezes only the geometry component. It excludes naming research, source-map research, independent review, final results, reconstruction index, overall package manifest and package validator. This is bounded evidence checking, not geometry repair, a maximal topology audit or live-deployment verification. Geometry and baseline labels alone establish no geographic naming verdict; automatic application remains false.
