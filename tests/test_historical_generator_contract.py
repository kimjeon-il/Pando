"""Geometry regeneration retains independently curated catalog presentation."""
import json
import runpy
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import MultiPolygon, box

ROOT = Path(__file__).resolve().parents[1]
BUILDER = runpy.run_path(str(ROOT / "tools/build-territorial-geometry.py"))


class HistoricalGeneratorContracts(unittest.TestCase):
    def test_geometry_recipe_updates_its_metadata_without_erasing_the_catalog_flag(self):
        build = BUILDER["build_entity"]
        recipe = {"entityId": "state:deutsche-demokratische-republik",
                  "id": "reference-geometry", "referenceDate": "1989-04-25", "output": "library.json",
                  "sources": {key: {"url": "https://source.example/", "license": "Public domain"}
                              for key in ("naturalEarthAdmin1", "amtNeuhaus", "berlinWall")}}
        original = {"schemaVersion": 1, "entityId": recipe["entityId"], "parentEntityId": "",
                    "canonicalName": "Curated identity", "displayNames": {"ko": "보존 이름"}, "alternateNames": ["curated alias"],
                    "lifetime": {"validFrom": "1949-10-07", "validTo": "1990-10-02"}, "instantiation": {"mode": "independent"},
                    "geometryVersions": [{"id": recipe["id"], "geometry": {"type": "Polygon", "coordinates": []}},
                                         {"id": "additional-source-version", "geometry": {"type": "Polygon", "coordinates": []}}],
                    "metadata": {"defaultFlagDataUrl": "curated-flag", "referenceDate": "1900-01-01"},
                    "sourceInfo": {"importProvenance": {"baseSha": "preserved"}}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / recipe["output"]
            source = json.dumps(original).encode("utf-8")
            path.write_bytes(source)
            previous_root = build.__globals__["ROOT"]
            build.__globals__["ROOT"] = root
            try:
                result = json.loads(build(recipe, MultiPolygon([box(0, 0, 1, 1)])))
            finally:
                build.__globals__["ROOT"] = previous_root
            self.assertEqual(path.read_bytes(), source, "building a candidate must not mutate its source")
        self.assertEqual(result["sourceInfo"]["importProvenance"], original["sourceInfo"]["importProvenance"])
        generated = result
        for key in ("canonicalName", "displayNames", "alternateNames", "lifetime", "instantiation"):
            self.assertEqual(generated[key], original[key])
        self.assertEqual(generated["geometryVersions"][1], original["geometryVersions"][1])
        self.assertEqual(generated["entityId"], recipe["entityId"])
        self.assertEqual(generated["metadata"]["defaultFlagDataUrl"], "curated-flag")
        self.assertEqual(generated["metadata"]["referenceDate"], recipe["referenceDate"])
        self.assertEqual(generated["geometryVersions"][0]["id"], recipe["id"])
