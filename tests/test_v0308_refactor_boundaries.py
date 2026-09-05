import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
PERSISTENCE = (ROOT / "assets/js/modules/persistence-service.js").read_text(encoding="utf-8")
SERIALIZER = (ROOT / "assets/js/modules/project-serializer.js").read_text(encoding="utf-8")
PHYSICAL = (ROOT / "assets/js/modules/physical-layer-service.js").read_text(encoding="utf-8")
TERRITORIAL_SERVICE = (ROOT / "assets/js/modules/territorial-service.js").read_text(encoding="utf-8")
DISTRIBUTION_SERVICE = (ROOT / "assets/js/modules/distribution-service.js").read_text(encoding="utf-8")
GENERIC_FEATURE_SERVICE = (ROOT / "assets/js/modules/generic-feature-service.js").read_text(encoding="utf-8")
RENDER_COORDINATOR = (ROOT / "assets/js/modules/map-render-coordinator.js").read_text(encoding="utf-8")
RENDERING_DOMAIN = (ROOT / "assets/js/modules/rendering-domain.js").read_text(encoding="utf-8")
GPU_RENDERER = (ROOT / "assets/js/modules/gpu-map-renderer.js").read_text(encoding="utf-8")
TOOLTIP_CONTROLLER = (ROOT / "assets/js/modules/tooltip-controller.js").read_text(encoding="utf-8")
CONFIRM_MODAL_CONTROLLER = (ROOT / "assets/js/modules/confirm-modal-controller.js").read_text(encoding="utf-8")
LAYER_TREE_CONTROLLER = (ROOT / "assets/js/modules/layer-tree-controller.js").read_text(encoding="utf-8")
HISTORY_SERVICE = (ROOT / "assets/js/modules/history-service.js").read_text(encoding="utf-8")
HISTORICAL_LIBRARY_SERVICE = (ROOT / "assets/js/modules/historical-library-service.js").read_text(encoding="utf-8")
IMPORT_SERVICE = (ROOT / "assets/js/modules/import-service.js").read_text(encoding="utf-8")
HISTORICAL_LIBRARY_CONTROLLER = (ROOT / "assets/js/modules/historical-library-controller.js").read_text(encoding="utf-8")
MAP_EDIT_WORKER_CLIENT = (ROOT / "assets/js/modules/map-edit-worker-client.js").read_text(encoding="utf-8")


class RefactorBoundaryTests(unittest.TestCase):
    def test_browser_project_storage_is_confined_to_the_persistence_module(self):
        self.assertNotIn("indexedDB.open", APP)
        self.assertNotIn("localStorage.setItem(STORAGE_KEY", APP)
        self.assertNotIn("localStorage.removeItem(STORAGE_KEY", APP)
        self.assertIn("indexedDB.open(databaseName", PERSISTENCE)
        self.assertIn("localStorage.setItem(fallbackKey", PERSISTENCE)

    def test_persistence_and_serializer_are_dom_free(self):
        for source in (PERSISTENCE, SERIALIZER, PHYSICAL, TERRITORIAL_SERVICE, DISTRIBUTION_SERVICE, GENERIC_FEATURE_SERVICE):
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
        self.assertIn("commandPipeline", TERRITORIAL_SERVICE)
        self.assertIn("runGeometryTransaction", TERRITORIAL_SERVICE)

    def test_distribution_and_genericFeature_crud_are_behind_services(self):
        self.assertIn("createDistributionService({", APP)
        self.assertIn("distributionService.updateLayer", APP)
        self.assertIn("distributionService.addEntry", APP)
        self.assertIn("createGenericFeatureService({", APP)
        self.assertIn("genericFeatureService.updateMetadata", APP)
        self.assertIn("genericFeatureService.remove", APP)
        self.assertIn("commandPipeline", DISTRIBUTION_SERVICE)
        self.assertIn("commandPipeline", GENERIC_FEATURE_SERVICE)

    def test_render_order_is_coordinated_and_renderer_is_dom_free(self):
        self.assertIn("createMapRenderCoordinator({", RENDERING_DOMAIN)
        self.assertNotIn("mapRenderCoordinator", APP)
        self.assertNotIn("MAP_RENDER_DIRTY", APP)
        self.assertIn("callRenderer('territorialUnits'", RENDER_COORDINATOR)
        self.assertIn("rendererUi.setEngineStatus", GPU_RENDERER)
        self.assertNotIn("document.", GPU_RENDERER)
        self.assertNotIn("$('engineStatus')", GPU_RENDERER)

    def test_dom_event_lifecycle_is_behind_ui_controllers(self):
        self.assertIn("createTooltipController({", APP)
        self.assertIn("createConfirmModalController({", APP)
        self.assertIn("createAppLayerTreeController({", APP)
        self.assertIn("return createLayerTreeController({", LAYER_TREE_CONTROLLER)
        self.assertIn("elements.cancel?.addEventListener", CONFIRM_MODAL_CONTROLLER)
        self.assertIn("elements.section?.addEventListener('click'", LAYER_TREE_CONTROLLER)
        self.assertIn("document.addEventListener('pointerover'", TOOLTIP_CONTROLLER)

    def test_document_history_is_behind_history_service(self):
        self.assertIn("createHistoryService({", APP)
        self.assertIn("historyService.record(meta)", APP)
        self.assertIn("historyService.undo", APP)
        self.assertIn("historyService.redo", APP)
        self.assertNotIn("state.history.push(", APP)
        self.assertIn("store.future = []", HISTORY_SERVICE)

    def test_historical_library_loading_and_queries_are_behind_service(self):
        self.assertIn("createHistoricalLibraryService({", APP)
        self.assertIn("await service.load()", HISTORICAL_LIBRARY_CONTROLLER)
        self.assertIn("instantiateDescriptors", HISTORICAL_LIBRARY_SERVICE)
        self.assertNotIn("pandolab:historical-library-ready", APP)

    def test_gis_import_staging_validation_and_materialization_are_behind_service(self):
        self.assertIn("createImportService({", APP)
        self.assertIn("createGisGeometryValidator({", APP)
        self.assertIn("await importService.openFiles", APP)
        self.assertIn("async function openFiles", IMPORT_SERVICE)
        self.assertIn("validateCountryCollection", IMPORT_SERVICE)
        self.assertNotIn("gisGeometryPending", APP)

    def test_historical_library_dom_lifecycle_is_behind_controller(self):
        self.assertIn("createHistoricalLibraryController({", APP)
        self.assertIn("historicalLibraryController.connect()", APP)
        self.assertIn("function renderResults()", HISTORICAL_LIBRARY_CONTROLLER)
        self.assertIn("function renderPreview()", HISTORICAL_LIBRARY_CONTROLLER)
        self.assertNotIn("function renderHistoricalLibraryResults", APP)

    def test_map_edit_worker_protocol_is_behind_client(self):
        self.assertIn("createMapEditWorkerClient({", APP)
        self.assertIn("ensureWorker().postMessage({", MAP_EDIT_WORKER_CLIENT)
        self.assertIn("type: 'execute'", MAP_EDIT_WORKER_CLIENT)
        self.assertIn("createLatestWorkerJobScheduler({", MAP_EDIT_WORKER_CLIENT)
        self.assertIn("Number(entry.geometryRevision) === dataRevision", MAP_EDIT_WORKER_CLIENT)
        self.assertIn("Number(entry.targetRevision) === currentTargetRevision()", MAP_EDIT_WORKER_CLIENT)
        self.assertNotIn("const mapEditClient = (() =>", APP)


if __name__ == "__main__":
    unittest.main()
