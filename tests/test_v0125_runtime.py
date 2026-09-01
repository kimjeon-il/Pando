from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
RENDERER = (ROOT / "assets" / "js" / "modules" / "gpu-map-renderer.js").read_text(encoding="utf-8")
TRANSACTION = (ROOT / "assets" / "js" / "modules" / "country-edit-transaction.js").read_text(encoding="utf-8")
WORKER = (ROOT / "assets" / "js" / "workers" / "hydro-tile-worker.js").read_text(encoding="utf-8")
CANVAS_WORKER = (ROOT / "assets" / "js" / "workers" / "canvas-render-worker.js").read_text(encoding="utf-8")


def section(source: str, start: str, end: str) -> str:
    return source[source.index(start):source.index(end, source.index(start))]


class V0125RuntimeTests(unittest.TestCase):
    def test_hydro_pack_delivery_does_not_trigger_full_app_render(self):
        handler = section(RENDERER, "function receiveHydroWorkerMessage", "function pruneHydroCache")
        self.assertNotIn("renderAll()", handler)
        self.assertIn("scheduleHydroUpload(entry)", handler)
        self.assertNotIn("renderLayerTree()", handler)  # progress no longer rebuilds layer rows

    def test_webgl_receives_mesh_descriptors_not_geojson(self):
        self.assertIn("features: includeGeometry ? pack.features : null", WORKER)
        self.assertIn("const wantedIncludeGeometry = rendererMode === 'canvas2d'", RENDERER)
        self.assertIn("includeGeometry: wantedIncludeGeometry", RENDERER)
        self.assertIn("descriptors", section(WORKER, "function postPack", "async function processView"))
        self.assertIn("new MessageChannel()", RENDERER)
        self.assertIn("canvasPort?.postMessage({ type: 'pack'", WORKER)
        self.assertIn("canvas.transferToImageBitmap()", CANVAS_WORKER)

    def test_detail_provenance_is_loaded_only_for_selection_or_copy(self):
        init = section(WORKER, "if (message.type === 'init')", "if (message.type === 'view')")
        load_feature = section(WORKER, "async function loadLogicalFeature", "onmessage = async")
        self.assertIn("manifest.metadata?.core?.url", init)
        self.assertNotIn("ensureDetailMetadata", init)
        self.assertIn("await ensureDetailMetadata()", load_feature)

    def test_country_mesh_and_annex_validation_are_revision_safe(self):
        self.assertIn("const pending = geometryRevisionTracker.isPending(id)", RENDERER)
        self.assertIn("base[offset + 3] = overridden ? 0 : visible", RENDERER)
        self.assertIn("override[offset + 3] = overridden && !pending ? visible : 0", RENDERER)
        self.assertIn("gpuMapRenderer.applyCountryPatch({ ids: [...changed], features, removedIds })", APP)
        annex = section(APP, "function completeLinearAnnexation", "function completeNewCountryCreation")
        self.assertIn("operation: 'annex'", annex)
        self.assertIn("client.execute(operation, payload)", TRANSACTION)
        validator = section(APP, "function validateCountryGeometryEdit", "function restoreCountryEditSnapshot")
        self.assertIn("overlapArea > previousArea + areaTolerance", validator)
        self.assertIn("boundaryLength || 0) * 2e-7", validator)


if __name__ == "__main__":
    unittest.main()
