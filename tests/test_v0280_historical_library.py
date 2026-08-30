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
        for entity in PILOT["entities"]:
            self.assertTrue(entity["metadata"]["pilot"])
            self.assertTrue(entity["metadata"]["approximateGeometry"])
            self.assertEqual(entity["geometryVersions"][0]["datePrecision"], "approximate")
            self.assertEqual(entity["geometryVersions"][0]["certainty"], "low")
            self.assertTrue(entity["sourceInfo"]["title"])

    def test_world_snapshot_is_a_template(self):
        self.assertIn("normalizeWorldSnapshot", MODEL)
        self.assertTrue(PILOT["snapshots"])
        self.assertIn("instantiate(snapshot.entityRefs", CONTROLLER)


if __name__ == "__main__":
    unittest.main()
