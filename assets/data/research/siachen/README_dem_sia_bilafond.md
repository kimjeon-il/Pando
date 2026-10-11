# Sia La – Bilafond La: independent terrain cross-check

Status: research-only topographic comparison. Copernicus DEM GLO-30 Public COG
is a digital surface model from TanDEM-X observations 2011–2015, not a surveyed
representation of a military control line. It is NOT a current satellite image.

DEM source: https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N35_00_E076_00_DEM/Copernicus_DSM_COG_10_N35_00_E076_00_DEM.tif

OSM candidate: relation 13559521 (2026-10-04), ODbL 1.0.
Physical glacier: RGI 7.0 (2002-07-10). Landform coordinate sources: Mapcarta / NGA Getty.

Files: sia_bilafond_dem_comparison.json (cross-sections and statistics),
sia_bilafond_dem_samples.geojson (line, toponym points, local height-max points),
sia_bilafond_cop30_relief.png (relief map and geometry),
sia_bilafond_sia_osm_transect.png and sia_bilafond_bila_osm_transect.png.

Method: sample profiles normal to the existing OSM candidate, select local
maxima up to 900m on either side after smoothing. This is a diagnostic
topographic statistic and NOT an authoritative ridgeline extraction.
A military boundary does not necessarily pass over profile maxima or
through pass labels. The OSM boundary should NOT be edited simply by
snapping to nearby high points, which may be unrelated peaks/spurs.

Copernicus attribution: Copernicus Digital Elevation Model, accessed from
https://registry.opendata.aws/copernicus-dem/
Full DEM raster not redistributable from this research repository;
only derived, source-attributed diagnostic images/measurements are saved.

Country geometries and the source AGPL candidate are unchanged.
