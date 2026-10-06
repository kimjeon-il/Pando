"""Geometry regeneration retains independently curated catalog presentation."""
import json
import runpy
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import MultiPolygon, box

ROOT = Path(__file__).resolve().parents[1]
BUILDER = runpy.run_path(str(ROOT / "tools/build-historical-library.py"))


class HistoricalGeneratorContracts(unittest.TestCase):
    def test_geometry_recipe_updates_its_metadata_without_erasing_the_catalog_flag(self):
        build = BUILDER["build_library"]
        recipe = {"entityId": "historical-country:deutsche-demokratische-republik",
                  "id": "reference-geometry", "referenceDate": "1989-04-25", "output": "library.json",
                  "sources": {key: {"url": "https://source.example/", "license": "Public domain"}
                              for key in ("naturalEarthAdmin1", "amtNeuhaus", "berlinWall")}}
        original = {"schemaVersion": 3, "entities": [
            {"libraryId": "unrelated", "metadata": {"defaultFlagDataUrl": "other-flag"}},
            {"libraryId": recipe["entityId"], "metadata": {
                "defaultFlagDataUrl": "curated-flag", "referenceDate": "1900-01-01"}},
            {"libraryId": "after", "metadata": {"curatedName": "kept"}},
        ]}
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
        self.assertEqual(result["entities"][0], original["entities"][0])
        self.assertEqual(result["entities"][2], original["entities"][2])
        generated = result["entities"][1]
        self.assertEqual(generated["libraryId"], recipe["entityId"])
        self.assertEqual(generated["metadata"]["defaultFlagDataUrl"], "curated-flag")
        self.assertEqual(generated["metadata"]["referenceDate"], recipe["referenceDate"])
        self.assertEqual(generated["geometryVersions"][0]["id"], recipe["id"])
