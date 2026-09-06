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
        self.assertGreaterEqual(len(PILOT["entities"]), 4)
        pilot_entities = [entity for entity in PILOT["entities"] if entity["metadata"].get("pilot")]
        self.assertGreaterEqual(len(pilot_entities), 3)
        for entity in pilot_entities:
            self.assertTrue(entity["metadata"]["pilot"])
            self.assertTrue(entity["metadata"]["approximateGeometry"])
            self.assertTrue(entity["sourceInfo"]["title"])
        east_germany = next(entity for entity in PILOT["entities"] if entity["libraryId"] == "historical-country:deutsche-demokratische-republik")
        supplemental_ids = {
            "historical-country:ukraine-1991-2014",
            "historical-country:kingdom-of-yugoslavia",
            "historical-country:sfr-yugoslavia",
            "historical-country:federal-republic-of-yugoslavia",
            "historical-country:sudan-1956-2011",
            "historical-country:indonesia-1945-2002",
        }
        self.assertEqual(east_germany["geometryVersions"][0]["datePrecision"], "reference-date")
        self.assertEqual(east_germany["geometryVersions"][0]["certainty"], "medium")
        self.assertEqual(east_germany["instantiation"]["mode"], "territory-replacement")
        for entity in pilot_entities:
            if entity["type"] != "country" or entity is east_germany or entity["libraryId"] == "historical-country:nagorno-karabakh":
                continue
            if entity["libraryId"] in supplemental_ids:
                self.assertEqual(entity["geometryVersions"][0]["datePrecision"], "reference-date")
                self.assertEqual(entity["geometryVersions"][0]["certainty"], "medium")
                continue
            self.assertEqual(entity["geometryVersions"][0]["datePrecision"], "approximate")
            self.assertEqual(entity["geometryVersions"][0]["certainty"], "low")

    def test_supplemental_historical_countries_have_territory_replacement_versions(self):
        expected = {
            "historical-country:ukraine-1991-2014": ("1991-08-24", "2014-03-17"),
            "historical-country:kingdom-of-yugoslavia": ("1918-12-01", "1941-04-17"),
            "historical-country:sfr-yugoslavia": ("1945-11-29", "1992-04-27"),
            "historical-country:federal-republic-of-yugoslavia": ("1992-04-27", "2003-02-04"),
            "historical-country:sudan-1956-2011": ("1956-01-01", "2011-07-08"),
            "historical-country:indonesia-1945-2002": ("1945-08-17", "2002-05-19"),
        }
        by_id = {entity["libraryId"]: entity for entity in PILOT["entities"]}
        for library_id, dates in expected.items():
            entity = by_id[library_id]
            self.assertEqual(entity["type"], "country")
            self.assertEqual(entity["instantiation"]["mode"], "territory-replacement")
            self.assertEqual((entity["startDate"], entity["endDate"]), dates)
            self.assertEqual(len(entity["geometryVersions"]), 1)
            self.assertEqual(entity["geometryVersions"][0]["validFrom"], dates[0])
            self.assertEqual(entity["geometryVersions"][0]["validTo"], dates[1])
            self.assertTrue(entity["metadata"]["approximateGeometry"])

    def test_soviet_union_has_fifteen_flagged_constituent_republics(self):
        children = [
            entity for entity in PILOT["entities"]
            if entity.get("parentLibraryId") == "historical-country:soviet-union"
        ]
        self.assertEqual(len(children), 15)
        for entity in children:
            self.assertEqual(entity["type"], "subunit")
            self.assertEqual(entity["sovereignLibraryId"], "historical-country:soviet-union")
            self.assertEqual(entity["adminLevel"], 1)
            self.assertTrue(entity["metadata"]["defaultFlagDataUrl"].startswith("data:image/svg+xml;base64,"))

    def test_east_prussia_is_a_high_certainty_embedded_country(self):
        entity = next(item for item in PILOT["entities"] if item["libraryId"] == "historical-country:east-prussia")
        version = entity["geometryVersions"][0]
        self.assertEqual(entity["type"], "country")
        self.assertEqual(entity["displayNames"]["ko"], "동프로이센주")
        self.assertEqual(entity["startDate"], "1878-04-01")
        self.assertEqual(entity["endDate"], "1920-01-10")
        self.assertEqual(entity["metadata"]["preferredInstanceId"], "HIST_DEU_OSTPREUSSEN_1900")
        self.assertEqual(entity["metadata"]["defaultColor"], "#53657A")
        self.assertEqual(entity["instantiation"]["mode"], "territory-replacement")
        self.assertNotIn("territoryMerge", entity["metadata"])
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
