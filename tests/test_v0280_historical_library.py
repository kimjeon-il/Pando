from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
MODEL = (ROOT / "assets" / "js" / "modules" / "historical-library.js").read_text(encoding="utf-8")
CONTROLLER = (ROOT / "assets" / "js" / "modules" / "historical-library-controller.js").read_text(encoding="utf-8")
PILOT = json.loads((ROOT / "assets" / "data" / "historical-library-pilot.json").read_text(encoding="utf-8"))


class V0280HistoricalLibraryTests(unittest.TestCase):
    def test_library_entity_and_geometry_version_are_separate(self):
        for field in (
            "libraryId", "canonicalName", "displayNames", "alternateNames", "startDate", "endDate",
            "parentLibraryId", "sovereignLibraryId", "geometryVersions", "sourceInfo",
        ):
            self.assertIn(field, MODEL)
        for field in ("validFrom", "validTo", "datePrecision", "certainty", "sourceId"):
            self.assertIn(field, MODEL)

    def test_current_and_past_are_dates_not_distinct_types(self):
        self.assertIn("COUNTRY: 'country'", MODEL)
        self.assertNotIn("COUNTRY: 'currentCountry'", MODEL)
        self.assertNotIn("COUNTRY: 'historicalCountry'", MODEL)
        self.assertIn("status === 'current'", MODEL)
        self.assertIn("status === 'past'", MODEL)

    def test_library_ui_is_separate_from_project_layers(self):
        for element_id in (
            "addFromLibraryBtn", "historicalLibraryModal", "historicalLibrarySearchInput",
            "historicalLibraryTypeInput", "historicalLibraryStatusInput", "historicalLibraryYearInput",
            "historicalLibraryGeographicRegionInput",
            "historicalLibraryResults", "historicalLibraryPreview", "historicalLibrarySnapshotInput",
            "historicalLibraryChildDepthInput", "historicalLibraryAddBtn",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn("window.PANDOLAB_HISTORICAL_LIBRARY", APP)

    def test_project_instances_track_but_do_not_mutate_library_sources(self):
        self.assertIn("sourceLibraryId", APP)
        self.assertIn("sourceGeometryVersion", APP)
        self.assertIn("instantiateLibraryEntity", MODEL)
        self.assertIn("geometry: clone(version.geometry)", MODEL)

    def test_pilot_data_discloses_approximation_and_sources(self):
        self.assertEqual(PILOT["schemaVersion"], 2)
        self.assertGreaterEqual(len(PILOT["entities"]), 2)
        pilot_entities = [entity for entity in PILOT["entities"] if entity["metadata"].get("pilot")]
        self.assertGreaterEqual(len(pilot_entities), 2)
        for entity in pilot_entities:
            self.assertTrue(entity["metadata"]["pilot"])
            self.assertTrue(entity["metadata"]["approximateGeometry"])
            self.assertEqual(entity["geometryVersions"][0]["datePrecision"], "approximate")
            self.assertEqual(entity["geometryVersions"][0]["certainty"], "low")
            self.assertTrue(entity["sourceInfo"]["title"])

    def test_east_prussia_is_a_high_certainty_embedded_country(self):
        entity = next(item for item in PILOT["entities"] if item["libraryId"] == "historical-country:east-prussia")
        version = entity["geometryVersions"][0]
        self.assertEqual(entity["type"], "country")
        self.assertEqual(entity["displayNames"]["ko"], "동프로이센주")
        self.assertEqual(entity["startDate"], "1878-04-01")
        self.assertEqual(entity["endDate"], "1920-01-10")
        self.assertEqual(entity["metadata"]["preferredInstanceId"], "HIST_DEU_OSTPREUSSEN_1900")
        self.assertEqual(entity["metadata"]["defaultColor"], "#53657A")
        self.assertEqual(entity["metadata"]["territoryMerge"], "imported-priority")
        self.assertEqual(version["id"], "ostpreussen-1878-1920-r2")
        self.assertEqual(version["datePrecision"], "exact")
        self.assertEqual(version["certainty"], "high")
        self.assertEqual(version["geometry"]["type"], "MultiPolygon")
        self.assertEqual(len(version["geometry"]["coordinates"]), 2)

    def test_world_snapshot_is_a_template(self):
        self.assertIn("normalizeWorldSnapshot", MODEL)
        self.assertTrue(PILOT["snapshots"])
        self.assertIn("instantiate(snapshot.entityRefs", CONTROLLER)


if __name__ == "__main__":
    unittest.main()
