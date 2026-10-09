#!/usr/bin/env python3
"""Corruption tests for included r13 records and complete lake geometries."""
import importlib.util,json,shutil,tempfile,sys
from pathlib import Path
sys.dont_write_bytecode=True
V=Path(__file__).with_name('validate-independent-review.py')

def replace_json(root,rel,mutate):
    p=root/rel;x=json.loads(p.read_text());mutate(x);p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')

def run():
    assert V.exists(),'Included public validator missing'
    spec=importlib.util.spec_from_file_location('review_validator',V);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
    root=V.parent.parent;baseline=v.validate(root)
    assert baseline['included_ordered_position_count']==101 and baseline['map_judgments_reproduced'] is False
    R='review/independent-review.json'; C='research/calcasieu/'; M='research/maurepas-salvador/'
    cases=[
      ('application',R,lambda x:x.update(automatic_application=True)),
      ('korean_name',R,lambda x:x['findings'][0].update(name_ko='unverified')),
      ('scalar_name',R,lambda x:x['findings'][2].update(whole_feature_scalar_name='Lake Salvador')),
      ('scalar_clearance',R,lambda x:x['findings'][0].update(whole_polygon_name_application_cleared=True)),
      ('label_only_identity',R,lambda x:x['findings'][0].update(label_overlap_alone_used_as_identity=True)),
      ('live_deployment',R,lambda x:x.update(current_live_deployment_checked=True)),
      ('restored_history',R,lambda x:x.update(historical_verdicts_restored=True)),
      ('fid_domain',R,lambda x:x['findings'][0].update(geometry_fids=[4114])),
      ('target_order',R,lambda x:x['findings'].reverse()),
      ('cumulative_count',R,lambda x:x.update(cumulative_distinct_targets=38)),
      ('scope_hold_erased',R,lambda x:x.update(new_scope_hold_ids=[])),
      ('scope_follow_up_erased',R,lambda x:x['findings'][2].update(follow_up_required=False)),
      ('invented_compound',R,lambda x:x['findings'][2].update(compound_named_waterbody_required_by_evidence=True)),
      ('northern_name_invented',R,lambda x:x['findings'][2].update(directly_supported_name_forms=['Lake Salvador','Invented Lake'])),
      ('exhaustive_union',R,lambda x:x['findings'][2].update(constituent_list_exhaustive=True)),
      ('precise_partition',R,lambda x:x['findings'][2].update(exact_name_partition_established=True)),
      ('cold_pending_erased',R,lambda x:x.update(preserved_pending_access_ids=[])),
      ('previous_holds_erased',R,lambda x:x.update(preserved_scope_hold_ids=[])),
      ('completion_erased',R,lambda x:x['findings'][2].update(full_feature_correspondence_review_completed=False)),
      ('access_gap_invented',R,lambda x:x['findings'][1].update(source_access_limited=True)),
      ('survey_claim',R,lambda x:x['findings'][0].update(exact_shoreline_verified=True)),
      ('freshwater_overclaim',R,lambda x:x['findings'][0].update(freshwater_classification_verified=True)),
      ('historical_judgments_reproduced',R,lambda x:x['historical_review'].update(historical_results_recomputed_by_public_validator=True)),
      ('source_vertex','selected-lake-geometries.geojson',lambda x:x['features'][0]['geometry']['coordinates'][0][5].__setitem__(0,-93.0)),
      ('baseline_vertex','selected-baseline-rendered-geometries.geojson',lambda x:x['features'][1]['geometry']['coordinates'][0][5].__setitem__(1,31.0)),
      ('ring_order','selected-baseline-rendered-geometries.geojson',lambda x:x['features'][2]['geometry']['coordinates'][0].reverse()),
      ('missing_target','selected-lake-geometries.geojson',lambda x:x['features'].pop()),
      ('research_scope',M+'findings.json',lambda x:x['records'][1].update(research_category='supported_generalized_water_identity')),
      ('research_completion_count',M+'findings.json',lambda x:x.update(full_feature_correspondence_review_completed_count=1)),
      ('source_fact_count',C+'target-identity-facts.json',lambda x:x['targets'][0].update(source_positions_including_closure=33)),
      ('source_fact_bounds',M+'target-identity-facts.json',lambda x:x['targets'][0]['source_bbox'].__setitem__(0,-91.0)),
      ('noaa_publication_date',C+'source-evidence.json',lambda x:x['sources'][0].update(publication_date='2022-05')),
      ('cpra_path_as_date',M+'source-evidence.json',lambda x:x['sources'][0].update(publication_date='2023-04-18')),
      ('repeated_map_as_source',M+'source-evidence.json',lambda x:x.update(independent_cartographic_identity_source_count=2)),
      ('failed_source_as_evidence',M+'source-evidence.json',lambda x:x['unused_acquisition_outcomes'][0].update(used_as_evidence=True)),
      ('failed_source_body_claim',M+'source-evidence.json',lambda x:x['unused_acquisition_outcomes'][2].update(source_content_acquired=True)),
      ('map_scope_completion',M+'map-scope-review.json',lambda x:x['records'][1].update(full_feature_correspondence_review_completed=False)),
      ('source_observation_count','review/source-observations.json',lambda x:x.update(distinct_acquired_publications=4)),
    ]
    rejected=[]
    with tempfile.TemporaryDirectory(prefix='included-r13-review-') as temp:
      target=Path(temp)/'package'
      for label,rel,mutate in cases:
        if target.exists():shutil.rmtree(target)
        shutil.copytree(root,target)
        replace_json(target,rel,mutate)
        try:v.validate_content(target)
        except (ValueError,KeyError,TypeError,IndexError):rejected.append(label)
        else:raise AssertionError('Semantic corruption accepted: '+label)
      shutil.rmtree(target);shutil.copytree(root,target)
      with (target/'selected-lake-geometries.geojson').open('a') as f:f.write(' ')
      try:v.validate(target)
      except ValueError:rejected.append('included_file_bytes')
      else:raise AssertionError('Changed included bytes accepted')
      replace_json(target,'review/public-input-pins.json',lambda x:x['files'][0].update(path='../outside.json'))
      try:v.check_integrity(target)
      except ValueError:rejected.append('nonincluded_pin_path')
      else:raise AssertionError('Nonincluded pin path accepted')
    result=dict(status='passed',mode='included_public_files_only',semantic_corruptions_rejected=len(cases),corrupt_fixtures_rejected=len(rejected),fixtures=rejected,map_judgments_reproduced=False,original_source_material_reopened=False,network_requests=0,original_inputs_modified=False)
    print(json.dumps(result,indent=2));return result
if __name__=='__main__':run()
