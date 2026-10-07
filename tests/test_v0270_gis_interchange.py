from __future__ import annotations
from tests.application_source import element_markup, node_json, read_application_sources, read_module

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
GIS = (ROOT / "assets" / "js" / "gis-io.js").read_text(encoding="utf-8")
ADAPTERS = (ROOT / "assets" / "js" / "gis-adapters.js").read_text(encoding="utf-8")
WORKER = (ROOT / "assets" / "js" / "workers" / "gis-gpkg-worker.js").read_text(encoding="utf-8")


class V0270GisInterchangeTests(unittest.TestCase):
    def test_gis_adapter_is_loaded_before_io_and_reused_by_worker(self):
        runtime = read_module(ROOT, 'app-runtime-dependencies.js')
        self.assertIn("loadClassicRuntime('./gis-adapters.js')", runtime)
        self.assertIn(".then(() => loadClassicRuntime('./gis-io.js'))", runtime)
        self.assertLess(runtime.index("loadClassicRuntime('./gis-adapters.js')"), runtime.index(".then(() => loadClassicRuntime('./gis-io.js'))"))
        self.assertIn('window.PandoLabGisAdapters', GIS)
        self.assertIn('importScripts(GIS_ADAPTER_URL.href)', WORKER)
        self.assertIn("GIS_ADAPTER_URL.searchParams.set('v', resolvedWorkerRevision)", WORKER)

    def test_territorial_and_distribution_tables_are_explicit(self):
        for table in ('entities', 'regions', 'distributions'):
            self.assertIn(f"'{table}'", ADAPTERS)
        for field in ('parent_id','entity_kind','valid_from','valid_to','source_entity_id','entry_id','layer_id','source_mode','territorial_unit_id','value','unit','certainty'):
            self.assertIn(field, ADAPTERS)
        for retired in ('language_distribution','ethnicity_distribution','religion_distribution','associated_country_id'):
            self.assertNotIn(retired, ADAPTERS)

    def test_territorial_distribution_export_materializes_geometry_without_mutating_project(self):
        self.assertIn("function countryGeometryIndex", ADAPTERS)
        self.assertIn("sourceMode === 'territorial'", ADAPTERS)
        self.assertIn("territorial_unit_id", ADAPTERS)
        self.assertIn("assert.deepEqual(state, before)", (ROOT / "tests" / "unit" / "gis-adapters.test.mjs").read_text(encoding="utf-8"))

    def test_unified_vector_targets_cover_all_new_domains(self):
        target = element_markup(INDEX,'gisTargetType')
        for value in ('general','regional','generic','distribution'):
            self.assertIn(f'<option value="{value}">', target)
        for retired in ('country','territory','administrative','region'):
            self.assertNotIn(f'<option value="{retired}">', target)
        self.assertNotIn('gisDistributionType', INDEX)
        self.assertIn('gisDistributionValueField', INDEX)
        transaction = read_module(ROOT,'gis-import-transaction.js')
        self.assertIn('function importGeoJsonDistributions', transaction)
        self.assertIn('normalizeImportPlan', GIS)

    def test_stable_ids_are_preserved_and_duplicate_ids_are_rejected(self):
        actual = node_json(ROOT, """
        await import('./assets/js/gis-adapters.js');
        const adapters=globalThis.PandoLabGisAdapters;
        const feature=id=>({type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{entry_id:id,layer_id:'L',value:80,source_mode:'territorial',territorial_unit_id:'T'}});
        const imported=adapters.mergeDistributionFeatures([{tableName:'distributions',features:[feature('stable')]}]);
        let duplicate=false;try{adapters.mergeDistributionFeatures([{tableName:'distributions',features:[feature('same'),feature('same')]}])}catch{duplicate=true}
        console.log(JSON.stringify({id:imported.entries[0].id,layerId:imported.entries[0].layerId,territorial:imported.entries[0].territorialUnitId,duplicate}));
        """)
        self.assertEqual(actual,{'id':'stable','layerId':'L','territorial':'T','duplicate':True})
        self.assertIn('assertUniqueProjectIds', read_module(ROOT,'project-state.js'))

    def test_export_crs_is_epsg_4326_and_multipolygons_are_preserved(self):
        self.assertIn("EPSG:4326", GIS)
        self.assertIn("geometryType: 'MULTIPOLYGON'", WORKER)
        self.assertIn("MultiPolygon", ADAPTERS)


if __name__ == "__main__":
    unittest.main()
