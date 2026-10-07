from __future__ import annotations
from tests.application_source import read_application_sources

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
PROJECT = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
SERIALIZER = (ROOT / "assets" / "js" / "modules" / "project-serializer.js").read_text(encoding="utf-8")
VERSIONS = (ROOT / "assets" / "js" / "modules" / "version-contract.js").read_text(encoding="utf-8")
TERRITORIAL = (ROOT / "assets" / "js" / "modules" / "territorial-units.js").read_text(encoding="utf-8")
DISTRIBUTION = (ROOT / "assets" / "js" / "modules" / "distribution-model.js").read_text(encoding="utf-8")
GIS_ADAPTERS = (ROOT / "assets" / "js" / "gis-adapters.js").read_text(encoding="utf-8")


class CurrentSchemaPolicyTests(unittest.TestCase):
    def test_project_save_and_load_use_central_schema_contract(self):
        self.assertIn("schemaVersion = PROJECT_SCHEMA_VERSION", SERIALIZER)
        self.assertIn("schemaVersion,", SERIALIZER)
        self.assertIn("prepareProjectForActivation(project", APP)
        self.assertIn("export const PROJECT_SCHEMA_VERSION = 10", VERSIONS)
        self.assertIn("export { PROJECT_SCHEMA_VERSION }", PROJECT)
        self.assertNotIn("migrateProject", PROJECT)
        self.assertIn("territorialEntities", SERIALIZER)
        self.assertIn("entityDelta", SERIALIZER)
        self.assertIn("createProjectObjectId", PROJECT)
        self.assertIn("crypto.randomUUID", PROJECT)

    def test_runtime_legacy_feature_shims_stay_outside_feature_code(self):
        combined = "\n".join((APP, TERRITORIAL, DISTRIBUTION))
        self.assertNotIn("migrateLegacyCountryRegions", combined)
        self.assertNotIn("migrateThematicGenericFeatures", combined)
        self.assertNotIn("administrative_areas", GIS_ADAPTERS)
        self.assertFalse((ROOT / "assets/js/modules/project-migrations.js").exists())

    def test_external_gis_columns_do_not_restore_internal_aliases(self):
        self.assertIn("parent_id", GIS_ADAPTERS)
        self.assertIn("entity_kind", GIS_ADAPTERS)
        self.assertNotIn("associated_country_id", GIS_ADAPTERS)
        self.assertNotIn("parent_territorial_unit_id", GIS_ADAPTERS)
        self.assertNotIn("countryRegions", GIS_ADAPTERS)


if __name__ == "__main__":
    unittest.main()
