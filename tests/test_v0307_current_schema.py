from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
PROJECT = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
TERRITORIAL = (ROOT / "assets" / "js" / "modules" / "territorial-units.js").read_text(encoding="utf-8")
DISTRIBUTION = (ROOT / "assets" / "js" / "modules" / "distribution-model.js").read_text(encoding="utf-8")
GIS_ADAPTERS = (ROOT / "assets" / "js" / "gis-adapters.js").read_text(encoding="utf-8")


class CurrentSchemaPolicyTests(unittest.TestCase):
    def test_project_save_and_load_use_one_required_schema(self):
        self.assertIn("schemaVersion: PROJECT_SCHEMA_VERSION", APP)
        self.assertIn("assertCurrentProjectSchema(project)", APP)
        self.assertIn("export const PROJECT_SCHEMA_VERSION = 3", PROJECT)
        self.assertIn("new Set(['name', 'validFrom', 'validTo'])", PROJECT)
        self.assertIn("createProjectObjectId", PROJECT)
        self.assertIn("crypto.randomUUID", PROJECT)

    def test_runtime_migration_shims_are_removed(self):
        combined = "\n".join((APP, TERRITORIAL, DISTRIBUTION))
        self.assertNotIn("migrateLegacyCountryRegions", combined)
        self.assertNotIn("migrateThematicGenericFeatures", combined)
        self.assertNotIn("administrative_areas", GIS_ADAPTERS)

    def test_external_gis_columns_do_not_restore_internal_aliases(self):
        self.assertIn("parent_id", GIS_ADAPTERS)
        self.assertIn("sovereign_id", GIS_ADAPTERS)
        self.assertNotIn("parent_territorial_unit_id", GIS_ADAPTERS)
        self.assertNotIn("countryRegions", GIS_ADAPTERS)


if __name__ == "__main__":
    unittest.main()
