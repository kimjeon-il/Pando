import unittest
import json,sys
import tempfile
from unittest.mock import patch
from pathlib import Path
from tools.gis.apply_ussr_1922_caspian import load_approved_inputs, generalize_caspian, SOURCE, USSR_ZIP, WATER_ZIP
sys.path.insert(0,str(Path(__file__).parents[1]/'tools/gis'))
from prepare_hydro_name_replacement_bundle import rewrite,metadata_section
from tools.gis.apply_ussr_1922_caspian import ARAL_NAMES,ROOT
from tools.gis import apply_ussr_1922_caspian as application

class Approved1922GeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs=load_approved_inputs(SOURCE/USSR_ZIP,SOURCE/WATER_ZIP)

    def test_reviewed_inputs_have_exact_identity_and_water_topology(self):
        self.assertEqual(len(self.inputs['display']['features']),5)
        self.assertEqual(len(self.inputs['network']['features']),266)
        self.assertTrue(self.inputs['water'].is_valid)
        self.assertEqual(len(self.inputs['water'].interiors),68)

    def test_report_failure_happens_before_source_mutation(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);source=root/'assets/data/territorial-entities/source/countries/state-soviet-union.json'
            source.parent.mkdir(parents=True);source.write_text(json.dumps({'geometryVersions':[]}))
            before=source.read_bytes()
            with patch.object(application,'ROOT',root),patch.object(application,'write',side_effect=OSError('locked reports')):
                with self.assertRaisesRegex(OSError,'locked reports'):
                    application.apply_countries({'display':{'features':[{'id':'state:soviet-union'}]}},root/'before.json')
            self.assertEqual(before,source.read_bytes())

    def test_display_retains_islands_endpoints_and_noncoast_roles(self):
        result=generalize_caspian(self.inputs)
        self.assertTrue(result['water'].is_valid)
        self.assertEqual(len(result['water'].interiors),68)
        self.assertLess(result['metrics']['verticesAfter'],result['metrics']['verticesBefore'])
        self.assertEqual(result['metrics']['nonEndpointIntersections'],0)
        for before,after in zip(self.inputs['network']['features'],result['network']['features']):
            self.assertEqual(before['properties'],after['properties'])
            self.assertEqual(before['geometry']['coordinates'][0],after['geometry']['coordinates'][0])
            self.assertEqual(before['geometry']['coordinates'][-1],after['geometry']['coordinates'][-1])
            if 'NOT_COAST' in before['properties'].get('hybrid_role',''):
                self.assertEqual(before['geometry'],after['geometry'])

class AralNameCorrectionTests(unittest.TestCase):
    def test_metadata_only_correction_preserves_geometry_and_other_features(self):
        base=ROOT/'assets/data/hydro/v0.13.2';manifest=json.loads((base/'manifest.json').read_text());bundle=(base/'hydro.bin').read_bytes()
        old=metadata_section(bundle,manifest['metadata']['core'])
        reviews={k:{**v,'previousNameKo':next(row['name'] for row in old if row.get('awId')==k)}for k,v in ARAL_NAMES.items()}
        corrected,packed,proof=rewrite(manifest,bundle,{},ROOT/'assets/data/hydro/hydronym-ko-overrides.json',lake_substitutions=reviews)
        new=metadata_section(packed,corrected['metadata']['core'])
        self.assertEqual(proof['originalGeometryShardsSha256'],proof['newGeometryShardsSha256'])
        self.assertEqual(proof['originalIndexSha256'],proof['newIndexSha256'])
        self.assertEqual(metadata_section(bundle,manifest['metadata']['detail']),metadata_section(packed,corrected['metadata']['detail']))
        self.assertEqual(manifest['sources']['independentHydronymReplacements'],corrected['sources']['independentHydronymReplacements'])
        for before,after in zip(old,new):
            expected=dict(before)
            if before.get('awId') in ARAL_NAMES:expected['name']=ARAL_NAMES[before['awId']]['nameKo']
            self.assertEqual(expected,after)
        self.assertEqual(set(proof['changedLakeFragments']),set(ARAL_NAMES))

if __name__=='__main__':unittest.main()
