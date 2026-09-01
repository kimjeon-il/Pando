from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
MODEL = (ROOT / "assets" / "js" / "modules" / "distribution-model.js").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
GENERIC_FEATURE_SERVICE = (ROOT / "assets" / "js" / "modules" / "generic-feature-service.js").read_text(encoding="utf-8")


class V0260DistributionModelTests(unittest.TestCase):
    def test_distribution_state_uses_shared_project_history_schema(self):
        for field in ("distributionLayers", "distributionEntries"):
            self.assertIn(f"name: '{field}', scope: 'document'", PROJECT_STATE)
            self.assertIn(f"{field}:", APP)
        self.assertIn("name: 'distributionSettings', scope: 'presentation'", PROJECT_STATE)
        self.assertIn("distributionSettings:", APP)

    def test_language_ethnicity_and_religion_share_one_model(self):
        for value in ("language", "ethnicity", "religion"):
            self.assertIn(f"{value.upper()}: '{value}'", MODEL)
        for symbol in (
            "normalizeDistributionLayer",
            "normalizeDistributionEntry",
            "validateDistributionModel",
            "dominantDistributionEntries",
        ):
            self.assertIn(f"function {symbol}", MODEL)
        self.assertIn("groups:", MODEL)

    def test_territorial_reference_and_free_geometry_modes_are_supported(self):
        self.assertIn("TERRITORIAL: 'territorial'", MODEL)
        self.assertIn("GEOMETRY: 'geometry'", MODEL)
        self.assertIn("territorialUnitId", MODEL)
        self.assertIn("share:", MODEL)
        self.assertIn("certainty:", MODEL)
        self.assertIn("validFrom:", MODEL)
        self.assertIn("validTo:", MODEL)

    def test_common_layer_tree_create_flow_and_editor_exist(self):
        for element_id in (
            "languagesLayerChildren",
            "ethnicitiesLayerChildren",
            "religionsLayerChildren",
            "addDistributionBtn",
            "distributionTypeModal",
            "distributionProperties",
            "distributionEntryList",
            "addTerritorialDistributionBtn",
            "addGeometryDistributionBtn",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn("window.PANDOLAB_DISTRIBUTIONS", APP)

    def test_old_thematic_genericFeature_categories_are_not_exposed_for_new_genericFeatures(self):
        rules = GENERIC_FEATURE_SERVICE[GENERIC_FEATURE_SERVICE.index("export const GENERIC_FEATURE_ROLE_RULES"):GENERIC_FEATURE_SERVICE.index("export const GENERIC_FEATURE_ROLE_LABELS")]
        self.assertNotIn('id="genericFeatureCategoryInput"', INDEX)
        for value in ("language", "ethnicity", "religion"):
            self.assertNotIn(f"{value}:", rules)
        normalizer = APP[APP.index("function normalizeProjectObjects"):APP.index("function normalizeHistoryMetadata")]
        self.assertNotIn("migrateThematicGenericFeatures", normalizer)

    def test_render_modes_are_data_driven_and_territorial_changes_are_independent(self):
        self.assertIn("DOMINANT: 'dominant'", MODEL)
        self.assertIn("INTENSITY: 'intensity'", MODEL)
        self.assertIn("function renderDistributions", APP)
        self.assertNotIn("distributionEntries", APP[APP.index("function setTerritorialUnitName"):APP.index("window.PANDOLAB_TERRITORIAL")])


if __name__ == "__main__":
    unittest.main()
