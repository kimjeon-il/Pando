from __future__ import annotations
from tests.application_source import assert_shell_versions, function_source, node_json, read_application_sources, read_module

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
EDIT_WORKER = (ROOT / "assets" / "js" / "workers" / "map-edit-worker.js").read_text(encoding="utf-8")
CANVAS_WORKER = (ROOT / "assets" / "js" / "workers" / "canvas-render-worker.js").read_text(encoding="utf-8")
TRANSACTION = (ROOT / "assets" / "js" / "modules" / "map-edit-transaction.js").read_text(encoding="utf-8")
MAP_INPUT = (ROOT / "assets" / "js" / "modules" / "map-input-controller.js").read_text(encoding="utf-8")
RENDERING_DOMAIN = (ROOT / "assets" / "js" / "modules" / "rendering-domain.js").read_text(encoding="utf-8")
RENDERER = (ROOT / "assets" / "js" / "modules" / "gpu-map-renderer.js").read_text(encoding="utf-8")
COUNTRY_GEOMETRY = (ROOT / "assets" / "js" / "modules" / "polygon-geometry.js").read_text(encoding="utf-8")
PERSISTENCE = (ROOT / "assets" / "js" / "modules" / "persistence-service.js").read_text(encoding="utf-8")


class V0210PerformancePipelineTests(unittest.TestCase):
    def test_version_and_incremental_country_renderer(self):
        assert_shell_versions(self, ROOT, (ROOT / 'index.html').read_text(encoding='utf-8'))
        for interface in ('applyCountryPatch','setHydroInteractionActive','renderViewFrame','compactCountryOverrides'):
            self.assertIn(interface, RENDERER)
        for state in ('countryOverrideIds','overridePaletteTexture','committedGeometryRevision','displayedGeometryRevision'):
            self.assertIn(state, RENDERER)
        patch = function_source(read_module(ROOT,'app-spatial-index.js'),'markCountryGeometriesChanged')
        self.assertIn('invalidateGeometryCaches(changed)', patch)
        self.assertIn('applyCountryPatch(', patch)
        self.assertIn('features, removedIds', patch)
        self.assertIn('mapEditClient.syncPatch(changed)', patch)
        self.assertIn('geometryRevisionTracker.isCurrent(token, commit.revision)', RENDERER)
        self.assertIn('Number(message.geometryRevision || 0) >= geometryRevisionTracker.committedRevision()', RENDERER)

    def test_edit_worker_protocol_and_operations(self):
        for message_type in ('execute','commit','discard','cancel','sync-patch','rebase'):
            self.assertIn(f"'{message_type}'", EDIT_WORKER)
        calculator = read_module(ROOT,'map-edit-country-commands.js')
        for operation in ('executeAnnex','executeMerge','executeNewCountry','subtractAreaFromGeometry','normalizePolygonGeometry'):
            self.assertIn(operation, calculator)
        self.assertIn('createCountryCommandCalculator(self.polygonClipping).calculate(message', EDIT_WORKER)
        self.assertIn('assertRequestCurrent(message', EDIT_WORKER)
        self.assertIn('validateResult(working, affectedIds, baseline)', calculator)
        self.assertIn('root.PandoLabPolygonGeometry', COUNTRY_GEOMETRY)
        self.assertIn('client.execute(operation, payload)', TRANSACTION)
        for operation in ("operation: 'annex'", "operation: 'merge'", "operation: 'new-country'"):
            self.assertIn(operation, APP)

    def test_navigation_uses_view_only_frame(self):
        self.assertIn('createMapInputController', APP)
        self.assertNotIn('scheduleViewRender', APP)
        self.assertIn('invalidateView();', MAP_INPUT)
        self.assertIn('const invalidateView = reason => invalidate(', RENDERING_DOMAIN)
        self.assertIn('MAP_RENDER_MASKS.VIEW', RENDERING_DOMAIN)
        self.assertIn('renderTerritorialLabelPositions(frame)', RENDERING_DOMAIN)
        self.assertIn('renderUserLabelPositions(frame)', RENDERING_DOMAIN)
        self.assertIn('mapWorkScheduler.setInteractionActive(true)', read_module(ROOT,'map-input-presentation.js'))

    def test_background_work_is_budgeted(self):
        terrain = read_module(ROOT,'gpu-terrain-preparation.js')
        self.assertIn('terrainUploadQueue', terrain)
        self.assertIn('scheduleTerrainUpload', terrain)
        self.assertIn('uploadScheduler.enqueueUpload(', terrain)
        self.assertIn('uploadScheduler.enqueueUpload(', RENDERER)
        result = node_json(ROOT, r"""
        import {createGpuUploadScheduler} from './assets/js/modules/gpu-upload-scheduler.js';
        const frames=[];let now=1000,steps=0;
        const scheduler=createGpuUploadScheduler({requestFrame:fn=>(frames.push(fn),frames.length),cancelFrame:()=>{},now:()=>now,isHidden:()=>false,isInputPending:()=>false,getByteBudget:()=>100});
        const complete=scheduler.enqueueUpload({key:'bounded',step:({byteBudget})=>{steps++;return{bytes:byteBudget,done:steps===2}}});
        frames.shift()();const first={steps,pending:scheduler.getStats().pending};
        scheduler.noteInput(true);frames.shift()();const interacting=steps;
        scheduler.noteInput(false);now+=600;frames.shift()();await complete;
        console.log(JSON.stringify({first,interacting,steps,pending:scheduler.getStats().pending}));scheduler.dispose();
        """)
        self.assertEqual(result, {'first':{'steps':1,'pending':1},'interacting':1,'steps':2,'pending':0})
        self.assertIn("scheduler.scheduleIdle('autosave'", PERSISTENCE)
        self.assertIn("scheduler.scheduleIdle('view-autosave'", PERSISTENCE)
        self.assertIn("message.type === 'patch'", CANVAS_WORKER)
        self.assertIn('incomingGeometryRevision < geometryRevision', CANVAS_WORKER)


if __name__ == "__main__":
    unittest.main()
