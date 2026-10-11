#!/usr/bin/env python3
"""Corruption tests for included public facts and geometry, without source replay."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('public_review_validator', Path(__file__).with_name('validate-independent-review.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

def replace_json(root, rel, mutate):
    path = root / rel
    value = json.loads(path.read_text())
    mutate(value)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def run():
    root = Path(__file__).resolve().parent.parent
    assert hasattr(v, 'validate'), 'Included-public-files validation API is missing'
    baseline = v.validate(root)
    assert baseline['mode'] == 'included_public_files_only'
    assert baseline['map_judgments_reproduced'] is False
    assert baseline['original_source_material_reopened'] is False
    assert baseline['private_source_replay_supported'] is False
    review = 'review/independent-review.json'
    mw = 'research/montreal-wapawekka/'
    third = 'research/mirond/'
    cases = [
        ('automatic_application', review, lambda x: x.update(automatic_application=True)),
        ('korean_name', review, lambda x: x['findings'][0].update(name_ko='unverified')),
        ('scalar_name_promotion', review, lambda x: x['findings'][2].update(whole_feature_scalar_name='Mirond Lake')),
        ('scalar_clearance', review, lambda x: x['findings'][0].update(whole_polygon_name_application_cleared=True)),
        ('label_only_identity', review, lambda x: x['findings'][0].update(label_overlap_alone_used_as_identity=True)),
        ('history_restored', review, lambda x: x.update(historical_verdicts_restored=True)),
        ('target_order', review, lambda x: x['findings'].reverse()),
        ('fid_domain', review, lambda x: x['findings'][0].update(geometry_fids=[3959])),
        ('record_count', review, lambda x: x['findings'].pop()),
        ('registry_claim', review, lambda x: x['findings'][0].update(formal_registry_verified=True)),
        ('compound_hold_erased', review, lambda x: x['findings'][2].update(research_category='supported_generalized_water_identity')),
        ('scope_follow_up_erased', review, lambda x: x['findings'][2].update(follow_up_required=False)),
        ('completed_scope_erased', review, lambda x: x['findings'][0].update(full_feature_correspondence_review_completed=False)),
        ('cold_pending_erased', review, lambda x: x.update(preserved_pending_access_ids=[])),
        ('two_lake_union_overclaim', review, lambda x: x['findings'][2].update(constituent_list_exhaustive=True)),
        ('precise_partition_overclaim', review, lambda x: x['findings'][2].update(exact_name_partition_established=True)),
        ('settlement_name_promoted', review, lambda x: x['findings'][2].update(settlement_label_promoted_to_water_name=True)),
        ('wood_association_erased', third+'findings.json', lambda x: x['records'][0].update(directly_supported_name_forms=['Mirond Lake'])),
        ('research_source_access_changed', mw+'findings.json', lambda x: x['records'][0].update(source_access_limited=True)),
        ('research_completion_count_changed', mw+'findings.json', lambda x: x.update(full_feature_correspondence_review_completed_count=1)),
        ('source_interior_vertex', 'selected-lake-geometries.geojson', lambda x: x['features'][0]['geometry']['coordinates'][0][5].__setitem__(0,-105.4)),
        ('baseline_interior_vertex', 'selected-baseline-rendered-geometries.geojson', lambda x: x['features'][1]['geometry']['coordinates'][0][5].__setitem__(1,55.0)),
        ('ring_order', 'selected-baseline-rendered-geometries.geojson', lambda x: x['features'][2]['geometry']['coordinates'][0].reverse()),
        ('dropped_full_target', 'selected-lake-geometries.geojson', lambda x: x['features'].pop()),
        ('identity_bbox', mw+'target-identity-facts.json', lambda x: x['targets'][0]['source_bbox'].__setitem__(0,-106)),
        ('identity_position_count', third+'target-identity-facts.json', lambda x: x['source_geometry'].update(total_coordinates_including_closure=150)),
        ('wsa_url_year_as_date', mw+'source-evidence.json', lambda x: x['sources'][0].update(publication_date='2025-05-01')),
        ('duplicate_map_as_two_sources', mw+'source-evidence.json', lambda x: x['sources'].append(dict(x['sources'][0]))),
        ('unrecognized_source_field', mw+'source-evidence.json', lambda x: x['sources'][0].update(unincluded_material_reference='omitted-evidence')),
        ('unused_index_as_corroboration', 'review/source-observations.json', lambda x: x['observations'][1].update(counted_as_naming_source=True)),
        ('new_acquisition_claim', third+'source-evidence.json', lambda x: x['sources'][0].update(retrieved_this_batch=True)),
        ('past_review_claimed_as_recomputed', review, lambda x: x['historical_review'].update(historical_results_recomputed_by_public_validator=True)),
        ('map_partition_overclaim', third+'map-scope-review.json', lambda x: x['region_checks'][0].update(exact_partition_established=True)),
    ]
    rejected = []
    with tempfile.TemporaryDirectory(prefix='included-lake-review-tests-') as temp:
        root_copy = Path(temp) / 'package'
        for label, rel, mutate in cases:
            if root_copy.exists(): shutil.rmtree(root_copy)
            root_copy.mkdir()
            for folder in ('review','research'): shutil.copytree(root/folder,root_copy/folder)
            for name in v.GEOMETRY_FILES: shutil.copy2(root/name,root_copy/name)
            replace_json(root_copy, rel, mutate)
            try:
                # Skip byte pins here so each assertion tests semantic consistency.
                v.validate_content(root_copy)
            except (ValueError, KeyError, TypeError, IndexError):
                rejected.append(label)
            else: raise AssertionError('Semantic corruption accepted: '+label)
        if root_copy.exists(): shutil.rmtree(root_copy)
        root_copy.mkdir()
        for folder in ('review','research'): shutil.copytree(root/folder,root_copy/folder)
        for name in v.GEOMETRY_FILES: shutil.copy2(root/name,root_copy/name)
        with (root_copy/'selected-lake-geometries.geojson').open('a') as f: f.write(' ')
        try: v.validate(root_copy)
        except ValueError: rejected.append('included_file_byte_change')
        else: raise AssertionError('Changed included bytes accepted')
        replace_json(root_copy,'review/public-input-pins.json',lambda x:x['files'][0].update(path='../not-included.json'))
        try: v.check_integrity(root_copy)
        except ValueError: rejected.append('nonincluded_pin_path')
        else: raise AssertionError('Nonincluded input path accepted')
    unsupported = subprocess.run([sys.executable,str(Path(__file__).with_name('validate-independent-review.py')),'--input-cache','unused'],capture_output=True,text=True)
    assert unsupported.returncode != 0, 'Source replay interface unexpectedly supported'
    print(json.dumps({'status':'passed','mode':'included_public_files_only','semantic_corruptions_rejected':len(cases),'corrupt_fixtures_rejected':len(rejected),'fixtures':rejected,'unsupported_replay_option_rejected':True,'map_judgments_reproduced':False,'original_source_material_reopened':False,'network_requests':0,'original_inputs_modified':False},indent=2))

if __name__ == '__main__': run()
