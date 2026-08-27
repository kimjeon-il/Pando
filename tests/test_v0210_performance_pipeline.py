from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
EDIT_WORKER = (ROOT / "assets" / "js" / "workers" / "map-edit-worker.js").read_text(encoding="utf-8")
CANVAS_WORKER = (ROOT / "assets" / "js" / "workers" / "canvas-render-worker.js").read_text(encoding="utf-8")
TRANSACTION = (ROOT / "assets" / "js" / "modules" / "country-edit-transaction.js").read_text(encoding="utf-8")
MAP_INPUT = (ROOT / "assets" / "js" / "modules" / "map-input-controller.js").read_text(encoding="utf-8")
RENDERER = (ROOT / "assets" / "js" / "modules" / "gpu-map-renderer.js").read_text(encoding="utf-8")
COUNTRY_GEOMETRY = (ROOT / "assets" / "js" / "modules" / "country-geometry.js").read_text(encoding="utf-8")


class V0210PerformancePipelineTests(unittest.TestCase):
    def test_version_and_incremental_country_renderer(self):
        self.assertIn("const APP_VERSION = '0.30.0'", APP)
        for interface in ("applyCountryPatch", "setInteractionActive", "renderViewFrame", "compactCountryOverrides"):
            self.assertIn(interface, RENDERER)
        self.assertIn("countryOverrideIds", RENDERER)
        self.assertIn("overridePaletteTexture", RENDERER)
        self.assertIn("country-patch-preview", APP)
        self.assertIn("markCountryGeometriesChanged(new Set(result.affectedIds", APP)
        self.assertIn("createCountryGeometryRevisionTracker", RENDERER)
        self.assertIn("committedGeometryRevision", RENDERER)
        self.assertIn("displayedGeometryRevision", RENDERER)
        self.assertIn("geometryRevision >= geometryRevisionTracker.committedRevision()", RENDERER)

    def test_edit_worker_protocol_and_operations(self):
        for message_type in ("execute", "commit", "discard", "cancel", "sync-patch", "rebase"):
            self.assertIn(f"'{message_type}'", EDIT_WORKER)
        self.assertIn("executeAnnex", EDIT_WORKER)
        self.assertIn("executeMerge", EDIT_WORKER)
        self.assertIn("executeNewCountry", EDIT_WORKER)
        self.assertIn("subtractRegionFromGeometry", EDIT_WORKER)
        self.assertIn("regionPolygonsNearFeatures", EDIT_WORKER)
        self.assertIn("normalizeCountryGeometry", EDIT_WORKER)
        self.assertIn("hasCanonicalCountryWinding", EDIT_WORKER)
        self.assertIn("root.PandoLabCountryGeometry", COUNTRY_GEOMETRY)
        self.assertIn("normalizeCountryGeometry(feature.geometry)", APP)
        self.assertIn("client.execute(operation, payload)", TRANSACTION)
        for operation in ("operation: 'annex'", "operation: 'merge'", "operation: 'new-country'"):
            self.assertIn(operation, APP)

    def test_navigation_uses_view_only_frame(self):
        self.assertIn("function scheduleViewRender()", APP)
        self.assertIn("createMapInputController", APP)
        self.assertIn("scheduleViewRender();", MAP_INPUT)
        self.assertIn("renderCountryLabelPositions()", APP)
        self.assertIn("renderUserLabelPositions()", APP)
        self.assertIn("mapWorkScheduler.setInteractionActive(true)", APP)

    def test_background_work_is_budgeted(self):
        self.assertIn("terrainUploadQueue", RENDERER)
        self.assertIn("scheduleTerrainUpload", RENDERER)
        self.assertIn("const byteBudget = 2 * 1024 * 1024", RENDERER)
        self.assertIn("entry.uploadState.tasks.shift()", RENDERER)
        self.assertIn("mapWorkScheduler.scheduleIdle('autosave'", APP)
        self.assertIn("mapWorkScheduler.scheduleIdle('view-autosave'", APP)
        self.assertIn("message.type === 'patch'", CANVAS_WORKER)
        self.assertIn("incomingGeometryRevision < geometryRevision", CANVAS_WORKER)


if __name__ == "__main__":
    unittest.main()
