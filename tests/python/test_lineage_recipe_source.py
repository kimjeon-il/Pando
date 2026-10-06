import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import unittest
from shapely.geometry import Polygon

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("territorial_geometry", ROOT / "tools/build-territorial-geometry.py")
builder = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = builder
spec.loader.exec_module(builder)


class LineageRecipeSourceTests(unittest.TestCase):
    def test_recipe_updates_only_target_version_and_keeps_curated_lineage(self):
        original = json.loads((ROOT / "assets/data/territorial-entities/source/countries/germany.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "germany.json"
            file.write_text(json.dumps(original), encoding="utf-8")
            recipe = json.loads(builder.DEFAULT_RECIPE.read_text(encoding="utf-8"))
            recipe["output"] = str(file)
            result = json.loads(builder.build_entity(recipe, Polygon([(0, 0), (1, 0), (1, 1), (0, 0)])))
            self.assertEqual(result["names"], original["names"])
            self.assertEqual(result["relations"], original["relations"])
            before = {e["entityId"]: e for e in original["entities"]}
            after = {e["entityId"]: e for e in result["entities"]}
            for entity_id in before:
                if entity_id != recipe["entityId"]:
                    self.assertEqual(after[entity_id], before[entity_id])
            self.assertEqual(after[recipe["entityId"]]["names"], before[recipe["entityId"]]["names"])
            self.assertEqual(after[recipe["entityId"]]["geometryVersions"][0]["versionId"], recipe["id"])
            self.assertNotEqual(after[recipe["entityId"]]["geometryVersions"][0]["geometry"], before[recipe["entityId"]]["geometryVersions"][0]["geometry"])
            self.assertEqual(json.loads(file.read_text(encoding="utf-8")), original)


if __name__ == "__main__":
    unittest.main()
