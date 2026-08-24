from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
EDIT_WORKER = (ROOT / "assets" / "js" / "workers" / "map-edit-worker.js").read_text(encoding="utf-8")
CANVAS_WORKER = (ROOT / "assets" / "js" / "workers" / "canvas-render-worker.js").read_text(encoding="utf-8")


class V0210PerformancePipelineTests(unittest.TestCase):
    def test_version_and_incremental_country_renderer(self):
        self.assertIn("const APP_VERSION = '0.21.0'", APP)
        for interface in ("applyCountryPatch", "setInteractionActive", "renderViewFrame", "compactCountryOverrides"):
            self.assertIn(interface, APP)
        self.assertIn("countryOverrideIds", APP)
        self.assertIn("overridePaletteTexture", APP)
        self.assertIn("country-patch-preview", APP)
        self.assertIn("markCountryGeometriesChanged(changedCountryIds)", APP)

    def test_edit_worker_protocol_and_operations(self):
        for message_type in ("execute", "commit", "discard", "cancel", "sync-patch", "rebase"):
            self.assertIn(f"'{message_type}'", EDIT_WORKER)
        self.assertIn("executeAnnex", EDIT_WORKER)
        self.assertIn("executeMerge", EDIT_WORKER)
        self.assertIn("executeNewCountry", EDIT_WORKER)
        self.assertIn("subtractRegionFromGeometry", EDIT_WORKER)
        self.assertIn("regionPolygonsNearFeatures", EDIT_WORKER)
        self.assertIn("await mapEditClient.execute('annex'", APP)
        self.assertIn("await mapEditClient.execute('merge'", APP)
        self.assertIn("await mapEditClient.execute('new-country'", APP)

    def test_navigation_uses_view_only_frame(self):
        self.assertIn("function scheduleViewRender()", APP)
        self.assertIn("function renderFinalFrame()", APP)
        self.assertIn("renderCountryLabelPositions()", APP)
        self.assertIn("renderUserLabelPositions()", APP)
        self.assertIn("mapWorkScheduler.setInteractionActive(true)", APP)

    def test_background_work_is_budgeted(self):
        self.assertIn("terrainUploadQueue", APP)
        self.assertIn("scheduleTerrainUpload", APP)
        self.assertIn("const byteBudget = 2 * 1024 * 1024", APP)
        self.assertIn("entry.uploadState.tasks.shift()", APP)
        self.assertIn("mapWorkScheduler.scheduleIdle('autosave'", APP)
        self.assertIn("mapWorkScheduler.scheduleIdle('view-autosave'", APP)
        self.assertIn("message.type === 'patch'", CANVAS_WORKER)


if __name__ == "__main__":
    unittest.main()
