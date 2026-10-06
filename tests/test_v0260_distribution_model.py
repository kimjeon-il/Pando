from __future__ import annotations
from tests.application_source import element_markup, function_source, node_json, read_application_sources, read_module

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
MODEL = (ROOT / "assets" / "js" / "modules" / "distribution-model.js").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
GENERIC_FEATURE_SERVICE = (ROOT / "assets" / "js" / "modules" / "generic-feature-service.js").read_text(encoding="utf-8")


class V0260DistributionModelTests(unittest.TestCase):
    def test_distribution_state_uses_shared_project_history_schema(self):
        for field in ("distributionLayers", "distributionEntries"):
            self.assertIn(f"name: '{field}', scope: 'document'", PROJECT_STATE)
            self.assertIn(f"{field}:", APP)
        self.assertIn("name: 'distributionSettings', scope: 'presentation'", PROJECT_STATE)
        self.assertIn("distributionSettings:", APP)

    def test_named_distributions_share_one_model_without_retired_type_fields(self):
        actual = node_json(ROOT, """
        import { createDistributionLayer, normalizeDistributionLayers } from './assets/js/modules/distribution-model.js';
        const layers=['language','ethnicity','religion'].map(id=>createDistributionLayer({id,name:id,unit:'persons'}));
        let duplicate=false, retired=false;
        try { normalizeDistributionLayers([layers[0],layers[0]]); } catch { duplicate=true; }
        try { createDistributionLayer({id:'old',type:'language'}); } catch { retired=true; }
        console.log(JSON.stringify({layers,duplicate,retired}));
        """)
        self.assertEqual([layer['name'] for layer in actual['layers']], ['language', 'ethnicity', 'religion'])
        self.assertTrue(all(layer['schemaVersion'] == 3 and layer['unit'] == 'persons' for layer in actual['layers']))
        self.assertTrue(actual['duplicate'])
        self.assertTrue(actual['retired'])

    def test_territorial_reference_and_free_geometry_modes_are_supported(self):
        actual = node_json(ROOT, """
        import { createDistributionEntry } from './assets/js/modules/distribution-model.js';
        const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
        const a=createDistributionEntry({id:'a',layerId:'L',mode:'territorial',territorialUnitId:'entity',value:250,validFrom:'2000',validTo:'2001'});
        const b=createDistributionEntry({id:'b',layerId:'L',mode:'geometry',geometry,value:-12,certainty:'exact'});
        b.geometry.coordinates[0][0][0]=5;
        let invalid=0;for (const value of [Infinity,NaN,'',null]) { try { createDistributionEntry({id:'bad',layerId:'L',mode:'territorial',territorialUnitId:'entity',value}); } catch {invalid++;} }
        console.log(JSON.stringify({a,b,sourceX:geometry.coordinates[0][0][0],invalid}));
        """)
        self.assertEqual(actual['a']['territorialUnitId'], 'entity')
        self.assertEqual(actual['a']['value'], 250)
        self.assertEqual(actual['b']['value'], -12)
        self.assertEqual(actual['b']['certainty'], 'exact')
        self.assertEqual(actual['sourceX'], 0)
        self.assertEqual(actual['invalid'], 4)

    def test_common_layer_tree_create_flow_and_editor_exist(self):
        self.assertEqual(INDEX.count('id="addDistributionBtn"'), 1)
        editor = element_markup(INDEX, 'distributionProperties')
        self.assertIn('editor-object-form', editor)
        self.assertIn('distributionEntryList', editor)
        self.assertNotIn('distributionTypeModal', INDEX)
        self.assertIn('window.PANDOLAB_DISTRIBUTIONS', APP)
        creation = function_source(read_module(ROOT,'app-property-selection.js'),'createDistributionLayerFromPrompt')
        self.assertIn('distributionService.createLayer', creation)
        self.assertIn('applyDistributionSelectionIntent(layer.id)', creation)

    def test_old_thematic_genericFeature_categories_are_not_exposed_for_new_genericFeatures(self):
        rules = GENERIC_FEATURE_SERVICE[GENERIC_FEATURE_SERVICE.index("export const GENERIC_FEATURE_ROLE_RULES"):GENERIC_FEATURE_SERVICE.index("export const GENERIC_FEATURE_ROLE_LABELS")]
        self.assertNotIn('id="genericFeatureCategoryInput"', INDEX)
        for value in ("language", "ethnicity", "religion"):
            self.assertNotIn(f"{value}:", rules)
        normalizer = APP[APP.index("function normalizeProjectObjects"):APP.index("function normalizeHistoryMetadata")]
        self.assertNotIn("migrateThematicGenericFeatures", normalizer)

    def test_render_modes_are_data_driven_and_territorial_changes_are_independent(self):
        actual = node_json(ROOT, """
        import { DISTRIBUTION_RENDER_MODES, distributionValueRange, distributionValueAlpha } from './assets/js/modules/distribution-model.js';
        const entries=[{value:10},{value:20}];
        const range=distributionValueRange({valueScale:{mode:'auto'}},entries);
        console.log(JSON.stringify({modes:DISTRIBUTION_RENDER_MODES,range,low:distributionValueAlpha(10,range),high:distributionValueAlpha(20,range),empty:distributionValueRange({},[])}));
        """)
        self.assertEqual(actual['modes'], {'OVERLAP':'overlap','SINGLE':'single'})
        self.assertEqual(actual['range'], {'min':10,'max':20})
        self.assertLess(actual['low'], actual['high'])
        self.assertIsNone(actual['empty'])
        metadata = function_source(APP, 'setTerritorialEntityName')
        self.assertNotIn('distributionEntries', metadata)


if __name__ == "__main__":
    unittest.main()
