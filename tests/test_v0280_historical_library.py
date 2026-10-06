from __future__ import annotations
from tests.application_source import read_application_sources

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
MODEL = (ROOT / "assets" / "js" / "modules" / "territorial-library.js").read_text(encoding="utf-8")
CONTROLLER = (ROOT / "assets" / "js" / "modules" / "territorial-library-controller.js").read_text(encoding="utf-8")
PILOT = {"schemaVersion": 1, "entities": [json.loads(p.read_text(encoding="utf-8")) for p in (ROOT / "assets/data/territorial-entities/source").glob("*.json")], "snapshots": json.loads((ROOT / "assets/data/territorial-entities/generated/v1/index.json").read_text(encoding="utf-8"))["snapshots"]}
SERVICE = (ROOT / "assets/js/modules/territorial-library-service.js").read_text(encoding="utf-8")


class V0280HistoricalLibraryTests(unittest.TestCase):
    def test_library_entity_and_geometry_version_are_separate(self):
        for field in (
            "entityId", "canonicalName", "displayNames", "alternateNames", "lifetime",
            "parentEntityId", "geometryVersions", "sourceInfo",
        ):
            self.assertIn(field, MODEL)
        for field in ("validFrom", "validTo", "datePrecision", "certainty", "sourceId"):
            for entity in PILOT["entities"]:
                for version in entity["geometryVersions"]:
                    self.assertIn(field, version)

    def test_current_and_past_are_dates_not_distinct_types(self):
        self.assertIn("GENERAL: 'general'", MODEL)
        self.assertNotIn("COUNTRY: 'currentCountry'", MODEL)
        self.assertNotIn("COUNTRY: 'historicalCountry'", MODEL)
        self.assertIn("territorialEntityExistsAt(e,today())", SERVICE)
        self.assertNotIn("isHistorical", SERVICE)

    def test_library_ui_is_separate_from_project_layers(self):
        for element_id in (
            "addFromLibraryBtn", "historicalLibraryModal", "historicalLibrarySearchInput",
            "historicalLibraryTypeInput", "historicalLibraryStatusInput", "historicalLibraryYearInput",
            "historicalLibraryGeographicRegionInput",
            "historicalLibraryResults", "historicalLibraryPreview", "historicalLibrarySnapshotInput",
            "historicalLibraryChildDepthInput", "historicalLibraryAddBtn",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn("window.PANDOLAB_TERRITORIAL_LIBRARY", APP)

    def test_project_instances_track_but_do_not_mutate_library_sources(self):
        self.assertIn("sourceLibraryId", APP)
        self.assertIn("sourceGeometryVersion", APP)
        self.assertIn("instantiateLibraryEntity", MODEL)
        self.assertIn("geometry: structuredClone(version.geometry)", MODEL)

    def test_pilot_data_discloses_approximation_and_sources(self):
        self.assertEqual(PILOT["schemaVersion"], 1)
        self.assertGreaterEqual(len(PILOT["entities"]), 4)
        pilot_entities = [entity for entity in PILOT["entities"] if entity["metadata"].get("pilot")]
        self.assertGreaterEqual(len(pilot_entities), 3)
        for entity in pilot_entities:
            self.assertTrue(entity["metadata"]["pilot"])
            self.assertTrue(entity["metadata"]["approximateGeometry"])
            self.assertTrue(entity["sourceInfo"]["title"])
        east_germany = next(entity for entity in PILOT["entities"] if entity["entityId"] == "state:deutsche-demokratische-republik")
        supplemental_ids = {
            "state:ukraine",
            "state:yugoslavia",
            "state:sudan",
            "state:indonesia",
            "state:north-schleswig",
        }
        self.assertEqual(east_germany["geometryVersions"][0]["datePrecision"], "reference-date")
        self.assertEqual(east_germany["geometryVersions"][0]["certainty"], "medium")
        self.assertEqual(east_germany["instantiation"]["mode"], "territory-replacement")
        for entity in pilot_entities:
            if entity["entityKind"] != "general" or entity is east_germany or entity["entityId"] == "state:nagorno-karabakh":
                continue
            if entity.get("parentEntityId"):
                self.assertEqual(entity["geometryVersions"][0]["datePrecision"], "reference-year")
                self.assertEqual(entity["geometryVersions"][0]["certainty"], "medium")
                continue
            if entity["entityId"] in supplemental_ids:
                self.assertEqual(entity["geometryVersions"][0]["datePrecision"], "reference-date")
                self.assertEqual(entity["geometryVersions"][0]["certainty"], "medium")
                continue
            self.assertEqual(entity["geometryVersions"][0]["datePrecision"], "approximate")
            self.assertEqual(entity["geometryVersions"][0]["certainty"], "low")

    def test_supplemental_historical_countries_have_territory_replacement_versions(self):
        expected = {
            "state:ukraine": ("1991-08-24", "2014-03-17"),
            "state:yugoslavia": ("1918-12-01", "2003-02-04"),
            "state:sudan": ("1956-01-01", "2011-07-08"),
            "state:indonesia": ("1945-08-17", "2002-05-19"),
        }
        by_id = {entity["entityId"]: entity for entity in PILOT["entities"]}
        for library_id, dates in expected.items():
            entity = by_id[library_id]
            self.assertEqual(entity["entityKind"], "general")
            self.assertEqual(entity["instantiation"]["mode"], "territory-replacement")
            self.assertEqual((entity["lifetime"]["validFrom"], entity["lifetime"]["validTo"]), dates)
            if library_id == "state:yugoslavia":
                self.assertEqual(len(entity["geometryVersions"]), 3)
                self.assertEqual(entity["geometryVersions"][0]["validFrom"], "1918-12-01")
                self.assertEqual(entity["geometryVersions"][-1]["validTo"], "2003-02-04")
            else:
                self.assertEqual(len(entity["geometryVersions"]), 1)
                self.assertEqual(entity["geometryVersions"][0]["validFrom"], dates[0])
                self.assertEqual(entity["geometryVersions"][0]["validTo"], dates[1])
            self.assertTrue(entity["metadata"]["approximateGeometry"])

    def test_soviet_union_has_fifteen_flagged_constituent_republics(self):
        children = [
            entity for entity in PILOT["entities"]
            if entity.get("parentEntityId") == "state:soviet-union"
        ]
        self.assertEqual(len(children), 15)
        for entity in children:
            self.assertEqual(entity["entityKind"], "general")
            self.assertEqual(entity["parentEntityId"], "state:soviet-union")
            self.assertNotIn("adminLevel", entity)
            self.assertTrue(entity["metadata"]["defaultFlagDataUrl"].startswith("data:image/svg+xml;base64,"))

    def test_east_prussia_rebuild_preserves_identity_and_discloses_uncertainty(self):
        entity = next(item for item in PILOT["entities"] if item["entityId"] == "state:east-prussia")
        version = entity["geometryVersions"][0]
        self.assertEqual(entity["entityKind"], "general")
        self.assertEqual(entity["displayNames"]["ko"], "동프로이센주")
        self.assertEqual(entity["lifetime"]["validFrom"], "1878-04-01")
        self.assertEqual(entity["lifetime"]["validTo"], "1920-01-10")
        self.assertEqual(entity["metadata"]["preferredInstanceId"], "HIST_DEU_OSTPREUSSEN_1900")
        self.assertEqual(entity["metadata"]["defaultColor"], "#53657A")
        self.assertEqual(entity["instantiation"]["mode"], "territory-replacement")
        self.assertNotIn("territoryMerge", entity["metadata"])
        self.assertEqual(version["id"], "ostpreussen-1878-1920-r3")
        self.assertEqual(version["datePrecision"], "exact")
        self.assertEqual(version["certainty"], "medium")
        self.assertTrue(entity["metadata"]["approximateGeometry"])
        self.assertFalse(entity["metadata"]["production"])
        self.assertFalse(entity["metadata"]["validation"]["statisticalAreaWithinOnePercent"])
        self.assertEqual(entity["metadata"]["validation"]["redistributionPermission"], "unconfirmed")
        self.assertEqual(version["geometry"]["type"], "MultiPolygon")
        self.assertEqual(len(version["geometry"]["coordinates"]), 1)

    def test_north_schleswig_is_registered_as_a_reference_date_country(self):
        entity = next(item for item in PILOT["entities"] if item["entityId"] == "state:north-schleswig")
        self.assertEqual(entity["entityKind"], "general")
        self.assertEqual(entity["displayNames"]["ko"], "북슐레스비히")
        self.assertEqual(entity["geometryVersions"][0]["id"], "north-schleswig-1900-r3")
        self.assertEqual(entity["geometryVersions"][0]["validFrom"], "1900-01-01")
        self.assertEqual(entity["geometryVersions"][0]["validTo"], "1900-01-01")
        self.assertEqual(entity["geometryVersions"][0]["geometry"]["type"], "MultiPolygon")
        self.assertEqual(entity["instantiation"]["mode"], "territory-replacement")
        self.assertTrue(entity["metadata"]["approximateGeometry"])

    def test_world_snapshot_is_a_template(self):
        self.assertIn("normalizeTerritorialLibraryIndex", MODEL)
        self.assertTrue(PILOT["snapshots"])
        self.assertIn("instantiate(snapshot.entityRefs", CONTROLLER)


if __name__ == "__main__":
    unittest.main()
