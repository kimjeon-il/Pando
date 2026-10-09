#!/usr/bin/env python3
"""Mutation tests of included r14 records, linkage and complete lake rings."""
import importlib.util,json,shutil,tempfile,sys
from pathlib import Path
sys.dont_write_bytecode=True
V=Path(__file__).with_name('validate-independent-review.py')
def replace_json(root,rel,fn):
 p=root/rel;x=json.loads(p.read_text());fn(x);p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def run():
 assert V.exists(),'Included public validator missing'
 s=importlib.util.spec_from_file_location('v',V);v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
 root=V.parent.parent;baseline=v.validate(root)
 assert baseline['included_ordered_position_count']==136 and baseline['map_judgments_reproduced'] is False
 R='review/independent-review.json';L='research/white-grand/';T='research/timiskaming/'
 cases=[
 ('automatic_application',R,lambda x:x.update(automatic_application=True)),
 ('korean_name',R,lambda x:x['findings'][0].update(name_ko='unverified')),
 ('scalar_name',R,lambda x:x['findings'][2].update(whole_feature_scalar_name='Lake Timiskaming')),
 ('scalar_clearance',R,lambda x:x['findings'][1].update(whole_polygon_name_application_cleared=True)),
 ('label_only_identity',R,lambda x:x['findings'][1].update(label_overlap_alone_used_as_identity=True)),
 ('live_deployment',R,lambda x:x.update(current_live_deployment_checked=True)),
 ('restored_history',R,lambda x:x.update(historical_verdicts_restored=True)),
 ('fid_domain',R,lambda x:x['findings'][0].update(geometry_fids=[4004])),
 ('target_order',R,lambda x:x['findings'].reverse()),
 ('cumulative_count',R,lambda x:x.update(cumulative_distinct_targets=41)),
 ('grand_white_reversal',R,lambda x:x['findings'][0].update(candidate_name='White Lake')),
 ('grand_hold_erased',R,lambda x:x.update(new_scope_hold_ids=[])),
 ('grand_follow_up_erased',R,lambda x:x['findings'][0].update(follow_up_required=False)),
 ('grand_access_invented',R,lambda x:x['findings'][0].update(source_access_limited=True)),
 ('grand_completion_erased',R,lambda x:x['findings'][0].update(full_feature_correspondence_review_completed=False)),
 ('compound_invented',R,lambda x:x['findings'][0].update(compound_named_waterbody_required_by_evidence=True)),
 ('second_name_invented',R,lambda x:x['findings'][0].update(directly_supported_name_forms=['Grand Lake','Invented Lake'])),
 ('exhaustive_union',R,lambda x:x['findings'][0].update(constituent_list_exhaustive=True)),
 ('precise_partition',R,lambda x:x['findings'][0].update(exact_name_partition_established=True)),
 ('cold_pending_erased',R,lambda x:x.update(preserved_pending_access_ids=[])),
 ('previous_holds_erased',R,lambda x:x.update(preserved_scope_hold_ids=[])),
 ('timiskaming_pending_erased',R,lambda x:x.update(new_pending_access_ids=[])),
 ('timiskaming_false_completion',R,lambda x:x['findings'][2].update(full_feature_correspondence_review_completed=True)),
 ('timiskaming_false_map_identity',R,lambda x:x['findings'][2].update(actual_named_water_shapes_compared=True)),
 ('bilingual_equivalence_invented',R,lambda x:x['findings'][2].update(formal_bilingual_equivalence_verified=True)),
 ('unsourced_bilingual_variant',R,lambda x:x['findings'][2].update(directly_supported_name_forms=['Lake Timiskaming','Lac Temiscaming'])) ,
 ('survey_claim',R,lambda x:x['findings'][1].update(exact_shoreline_verified=True)),
 ('salinity_claim',R,lambda x:x['findings'][1].update(measured_salinity_verified=True)),
 ('historical_judgments_reproduced',R,lambda x:x['historical_review'].update(historical_results_recomputed_by_public_validator=True)),
 ('source_vertex','selected-lake-geometries.geojson',lambda x:x['features'][0]['geometry']['coordinates'][0][5].__setitem__(0,-93)),
 ('baseline_vertex','selected-baseline-rendered-geometries.geojson',lambda x:x['features'][1]['geometry']['coordinates'][0][5].__setitem__(1,31)),
 ('ring_order','selected-baseline-rendered-geometries.geojson',lambda x:x['features'][2]['geometry']['coordinates'][0].reverse()),
 ('missing_target','selected-lake-geometries.geojson',lambda x:x['features'].pop()),
 ('research_scope',L+'findings.json',lambda x:x['records'][0].update(research_category='supported_generalized_water_identity')),
 ('research_completion_count',T+'findings.json',lambda x:x.update(full_feature_correspondence_review_completed_count=1)),
 ('source_fact_count',L+'target-identity-facts.json',lambda x:x['targets'][0].update(source_positions_including_closure=42)),
 ('source_fact_bounds',T+'target-identity-facts.json',lambda x:x['targets'][0]['source_bbox'].__setitem__(0,-80)),
 ('cpra_path_as_date',L+'source-evidence.json',lambda x:x['sources'][0].update(publication_date='2023-04-18')),
 ('repeated_map_as_source',L+'source-evidence.json',lambda x:x.update(independent_cartographic_identity_source_count=2)),
 ('schematic_as_identity',T+'source-evidence.json',lambda x:x['sources'][1].update(identity_map_evidence=True)),
 ('failed_source_as_evidence',T+'source-evidence.json',lambda x:x['unused_acquisition_outcomes'][0].update(used_as_evidence=True)),
 ('failed_source_body_claim',T+'source-evidence.json',lambda x:x['unused_acquisition_outcomes'][2].update(source_content_acquired=True)),
 ('map_scope_completion',T+'map-scope-review.json',lambda x:x['records'][0].update(full_feature_correspondence_review_completed=True)),
 ('source_observation_count','review/source-observations.json',lambda x:x.update(distinct_acquired_publications=5)),
 ]
 rejected=[]
 with tempfile.TemporaryDirectory(prefix='included-r14-review-') as t:
  dst=Path(t)/'package'
  for label,rel,fn in cases:
   if dst.exists():shutil.rmtree(dst)
   shutil.copytree(root,dst);replace_json(dst,rel,fn)
   try:v.validate_content(dst)
   except (ValueError,KeyError,TypeError,IndexError):rejected.append(label)
   else:raise AssertionError('Semantic corruption accepted: '+label)
  shutil.rmtree(dst);shutil.copytree(root,dst)
  with (dst/'selected-lake-geometries.geojson').open('a') as f:f.write(' ')
  try:v.validate(dst)
  except ValueError:rejected.append('included_file_bytes')
  else:raise AssertionError('Changed included bytes accepted')
  replace_json(dst,'review/public-input-pins.json',lambda x:x['files'][0].update(path='../outside.json'))
  try:v.check_integrity(dst)
  except ValueError:rejected.append('nonincluded_pin_path')
  else:raise AssertionError('Nonincluded pin path accepted')
 result=dict(status='passed',mode='included_public_files_only',semantic_corruptions_rejected=len(cases),corrupt_fixtures_rejected=len(rejected),fixtures=rejected,map_judgments_reproduced=False,original_source_material_reopened=False,network_requests=0,original_inputs_modified=False)
 print(json.dumps(result,indent=2));return result
if __name__=='__main__':run()
