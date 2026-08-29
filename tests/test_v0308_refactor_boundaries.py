import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
PERSISTENCE = (ROOT / "assets/js/modules/persistence-service.js").read_text(encoding="utf-8")
SERIALIZER = (ROOT / "assets/js/modules/project-serializer.js").read_text(encoding="utf-8")
PHYSICAL = (ROOT / "assets/js/modules/physical-layer-service.js").read_text(encoding="utf-8")
TERRITORIAL_SERVICE = (ROOT / "assets/js/modules/territorial-service.js").read_text(encoding="utf-8")


class RefactorBoundaryTests(unittest.TestCase):
    def test_browser_project_storage_is_confined_to_the_persistence_module(self):
        self.assertNotIn("indexedDB.open", APP)
        self.assertNotIn("localStorage.setItem(STORAGE_KEY", APP)
        self.assertNotIn("localStorage.removeItem(STORAGE_KEY", APP)
        self.assertIn("indexedDB.open(databaseName", PERSISTENCE)
        self.assertIn("localStorage.setItem(fallbackKey", PERSISTENCE)

    def test_persistence_and_serializer_are_dom_free(self):
        for source in (PERSISTENCE, SERIALIZER, PHYSICAL, TERRITORIAL_SERVICE):
            self.assertNotIn("document.", source)
            self.assertNotIn("querySelector", source)
            self.assertNotIn("getElementById", source)

    def test_runtime_uses_narrow_persistence_and_serializer_factories(self):
        self.assertIn("createProjectSerializer({", APP)
        self.assertIn("createBrowserProjectStorage({", APP)
        self.assertIn("createPersistenceService({", APP)
        self.assertIn("persistenceService.writeProject(buildAutosaveData())", APP)

    def test_physical_manifest_lifecycle_is_behind_services(self):
        self.assertIn("createTerrainService({", APP)
        self.assertIn("createHydroService({", APP)
        self.assertIn("return terrainService.load(force)", APP)
        self.assertIn("return hydroService.load(force)", APP)
        self.assertIn("maxAttempts: 3", PHYSICAL)
        self.assertIn("timeoutMs: 15000", PHYSICAL)

    def test_territorial_transactions_are_behind_application_service(self):
        self.assertIn("createTerritorialApplicationService({", APP)
        self.assertIn("territorialApplicationService.updateMetadata", APP)
        self.assertIn("territorialApplicationService.replaceUnits", APP)
        self.assertIn("runDocumentMutation", TERRITORIAL_SERVICE)
        self.assertIn("runGeometryTransaction", TERRITORIAL_SERVICE)


if __name__ == "__main__":
    unittest.main()
