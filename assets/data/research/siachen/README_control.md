# Siachen — AGPL candidate and effective-control split (RESEARCH ONLY)

Source line: OpenStreetMap relation 13559521, 2026-10-04 snapshot (ODbL 1.0).
Derived source, immutable Git commit: https://raw.githubusercontent.com/uncovering-world/travel-regions-extraction/7f9129e8cdaa0bd3b4f8b1cd87338c11f037320a/data/custom-geometries/siachen.geojson
OpenStreetMap relation: https://www.openstreetmap.org/relation/13559521
Underlying line is from OSM relation v10 at 2026-10-04T06:57:51Z.

Additional inputs:
- Natural Earth v5.1.2 disputed-area polygon B45 (public domain)
- RGI 7.0 actual glacier outline (CC BY 4.0), survey image date 2002-07-10.

NOT an official demarcated border. The positions of military outposts are not independently surveyed.
The source line includes approximately 0.02 degrees of end extension for clipping other map datasets.
Do not treat the OSM approximation as a legal international border or exact military front.
The historical Operation Meghdoot date 1984-04-13 is NOT this line's geometry date.

Topology notes:
- The OSM line crosses Natural Earth's generalized polygon edges many times, resulting
  in multiple small fragments rather than only two polygons.
- Signed side classification combines pieces into IND and PAK candidate areas.
- Any split sliver is normalized against the exact original Natural Earth polygon;
  overlap ambiguities are resolved by keeping the eastern/IND candidate geometry
  and assigning the remaining territory to the western/PAK side.
- Areas of geometric adjustments are reported explicitly in siachen_control_comparison.json.
- The physical RGI glacier is preserved independently; ice-vs-AGPL conflicts are logged.
- GIS calculation snaps coordinates to a 0.000001 degree grid for topology. Original OSM and RGI geometries are preserved.

Re-use: The OSM source and derived effective-control polygon are subject to ODbL 1.0.
Attribution and derivative database licence compliance are required.
Do not merge these outputs into the canonical country database without licence review.

Files:
- siachen_agpl_osm_candidate.geojson: candidate approximate line (190 vertices)
- siachen_control_split_ne_10m.geojson: two parts of Natural Earth 1:10m B45
- siachen_control_split_ne_50m.geojson: two parts of Natural Earth 1:50m B45
- siachen_control_comparison.json: detailed QA, overlap diagnostics, source hashes
- siachen_control_comparison.png: research visual comparison

The main country polygons, glaciers and political histories are unchanged.
