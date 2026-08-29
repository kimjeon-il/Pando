import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
PERSISTENCE = (ROOT / "assets/js/modules/persistence-service.js").read_text(encoding="utf-8")
SERIALIZER = (ROOT / "assets/js/modules/project-serializer.js").read_text(encoding="utf-8")
PHYSICAL = (ROOT / "assets/js/modules/physical-layer-service.js").read_text(encoding="utf-8")
TERRITORIAL_SERVICE = (ROOT / "assets/js/modules/territorial-service.js").read_text(encoding="utf-8")
DISTRIBUTION_SERVICE = (ROOT / "assets/js/modules/distribution-service.js").read_text(encoding="utf-8")
DRAWING_SERVICE = (ROOT / "assets/js/modules/drawing-service.js").read_text(encoding="utf-8")
RENDER_COORDINATOR = (ROOT / "assets/js/modules/map-render-coordinator.js").read_text(encoding="utf-8")
GPU_RENDERER = (ROOT / "assets/js/modules/gpu-map-renderer.js").read_text(encoding="utf-8")


class RefactorBoundaryTests(unittest.TestCase):
    def test_browser_project_storage_is_confined_to_the_persistence_module(self):
        self.assertNotIn("indexedDB.open", APP)
        self.assertNotIn("localStorage.setItem(STORAGE_KEY", APP)
        self.assertNotIn("localStorage.removeItem(STORAGE_KEY", APP)
        self.assertIn("indexedDB.open(databaseName", PERSISTENCE)
        self.assertIn("localStorage.setItem(fallbackKey", PERSISTENCE)

    def test_persistence_and_serializer_are_dom_free(self):
        for source in (PERSISTENCE, SERIALIZER, PHYSICAL, TERRITORIAL_SERVICE, DISTRIBUTION_SERVICE, DRAWING_SERVICE):
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

    def test_distribution_and_drawing_crud_are_behind_services(self):
        self.assertIn("createDistributionService({", APP)
        self.assertIn("distributionService.updateLayer", APP)
        self.assertIn("distributionService.addEntry", APP)
        self.assertIn("createDrawingService({", APP)
        self.assertIn("drawingApplicationService.updateMetadata", APP)
        self.assertIn("drawingApplicationService.remove", APP)
        self.assertIn("runDocumentMutation", DISTRIBUTION_SERVICE)
        self.assertIn("runDocumentMutation", DRAWING_SERVICE)

    def test_render_order_is_coordinated_and_renderer_is_dom_free(self):
        self.assertIn("createMapRenderCoordinator({", APP)
        self.assertIn("mapRenderCoordinator.renderFull()", APP)
        self.assertIn("mapRenderCoordinator.renderView()", APP)
        self.assertIn("renderers.territorialUnits()", RENDER_COORDINATOR)
        self.assertIn("rendererUi.setEngineStatus", GPU_RENDERER)
        self.assertNotIn("document.", GPU_RENDERER)
        self.assertNotIn("$('engineStatus')", GPU_RENDERER)


if __name__ == "__main__":
    unittest.main()
