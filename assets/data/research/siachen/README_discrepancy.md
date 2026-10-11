# RGI versus OSM AGPL discrepancy diagnostic

This is a diagnostic of **source discrepancies**, not evidence of Pakistani troops on the glacier.
The AGPL is a cartographic line derived from OpenStreetMap, not a surveyed or bilateral line.
The RGI shape is the extent of ice observed in July 2002, not an international border.

Input: RGI2000-v7.0-G-14-20040, OSM relation 13559521 (2026-10-04),
Natural Earth disputed-area 1:10m and 1:50m.

Outputs: discrepancy diagnostic JSON, GeoJSON of disputed portions, detailed overview
and close-up images. In addition to RGI overlap within Natural Earth's schematic
dispute wedge, an independent east/west line mask evaluates glacier ice *outside*
that wedge. Never conflate these quantities.

Landmark QA includes Sia La, Bilafond La, Gyong La and K12 public coordinates; several reported India-held features fall to the west of the OSM line. This implies a cartographic accuracy/position warning, not evidence of Pakistan holding these passes. No military post coordinates are inferred.

No geometry is changed by this analysis.
