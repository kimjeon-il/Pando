# r38 lake geometry metadata

The selected targets, in order, are lakes_base:1159112221, lakes_base:1159110309 and lakes_base:1159112237. Each retained source and decoded baseline feature is one Polygon with one closed exterior ring and no interior rings. Their per-target position totals are 61, 49 and 20, totaling 130 positions including closures. Baseline FIDs are 15605, 15481 and 15607; logical FIDs are 4230, 4106 and 4232.

The included factual summaries preserve source IDs, baseline IDs, all part/ring counts, bounds, inventory classification and exact name-field presence. Source names are lake-413, lake-289 and lake-415. Source name_ko, name_en and name_original are empty; decoded core name is the placeholder, and detail has no name fields. Placeholders are not geographic names. No naming verdict is made here.

Complete original source polygons and full production-decoded polygons were compared privately in retained immutable baseline fd6744f5e72a0c1a107452dbde6d416ab57237db. Every part, ring and ordered position matched after source coordinates were rounded to six decimal places. Fresh decoder extraction reproduced the same selected output and descriptors. These are reports of private verification, not checks reproducible from this public component.

No complete coordinates, ring paths, raw source or inventory bodies, decoder dependencies, private diagrams, request/cache records or their fingerprints are included. Natural Earth attribution and its official terms link are included as bibliography. No rights claim is made for unrelated maps.

Run `python -B validate-geometry-reference.py --check-component-manifest` and `python -B test-geometry-reference.py`. The validator checks only included metadata, arithmetic and included-file hashes. The corruption suite uses fixed included-metadata pins and rebases editable receipts. It cannot reproduce omitted source-coordinate, inventory, decoder or prior-index verification. It exposes no omitted-input replay interface.

The included prior list contains 108 distinct IDs and has no overlap with these three new inventory targets. The resulting recorded count is 111. The eligible unrecorded queue decreases from 3,957 to 3,954 (3,412 river groups and 542 lakes). All prior two pending-access IDs and 32 prior scope-hold IDs are preserved and are not reassessed. This component does not decide whether the current research adds any new scope hold. Remaining queue counts do not claim historically never-reviewed status.
