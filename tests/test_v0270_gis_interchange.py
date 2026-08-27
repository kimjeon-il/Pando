from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
GIS = (ROOT / "assets" / "js" / "gis-io.js").read_text(encoding="utf-8")
ADAPTERS = (ROOT / "assets" / "js" / "gis-adapters.js").read_text(encoding="utf-8")
WORKER = (ROOT / "assets" / "js" / "workers" / "gis-gpkg-worker.js").read_text(encoding="utf-8")


class V0270GisInterchangeTests(unittest.TestCase):
    def test_gis_adapter_is_loaded_before_io_and_reused_by_worker(self):
        self.assertLess(INDEX.index("assets/js/gis-adapters.js"), INDEX.index("assets/js/gis-io.js"))
        self.assertIn("window.PandoLabGisAdapters", GIS)
        self.assertIn("importScripts(GIS_ADAPTER_URL.href)", WORKER)
        self.assertIn("GIS_ADAPTER_URL.searchParams.set('v', WORKER_REVISION)", WORKER)

    def test_territorial_and_distribution_tables_are_explicit(self):
        for table in (
            "territories", "administrative_units", "historical_regions",
            "language_distribution", "ethnicity_distribution", "religion_distribution",
        ):
            self.assertIn(table, ADAPTERS)
        for field in (
            "parent_id", "sovereign_id", "valid_from", "valid_to", "source_library_id",
            "entry_id", "layer_id", "source_mode", "region_id", "share", "certainty",
        ):
            self.assertIn(field, ADAPTERS)

    def test_region_distribution_export_materializes_geometry_without_mutating_project(self):
        self.assertIn("function countryGeometryIndex", ADAPTERS)
        self.assertIn("sourceMode === 'region'", ADAPTERS)
        self.assertIn("region_id", ADAPTERS)
        self.assertIn("assert.deepEqual(state, before)", (ROOT / "tests" / "unit" / "gis-adapters.test.mjs").read_text(encoding="utf-8"))

    def test_geojson_targets_cover_all_new_domains(self):
        target = INDEX[INDEX.index('id="geoJsonTargetType"'):INDEX.index('</select>', INDEX.index('id="geoJsonTargetType"'))]
        for value in ("region", "administrative", "historicalRegion", "language", "ethnicity", "religion"):
            self.assertIn(f'<option value="{value}">', target)
        self.assertIn("function importGeoJsonHistoricalRegions", APP)
        self.assertIn("function importGeoJsonDistributions", APP)

    def test_stable_ids_are_preserved_and_duplicate_ids_are_rejected(self):
        self.assertIn("properties.entry_id", ADAPTERS)
        self.assertIn("분포 엔트리 ID 충돌", ADAPTERS)
        self.assertIn("영역 ID 충돌", GIS)

    def test_export_crs_is_epsg_4326_and_multipolygons_are_preserved(self):
        self.assertIn("EPSG:4326", GIS)
        self.assertIn("geometryType: 'MULTIPOLYGON'", WORKER)
        self.assertIn("MultiPolygon", ADAPTERS)


if __name__ == "__main__":
    unittest.main()
