#!/usr/bin/env python3
"""Mutation tests of included r17 records, linkage and complete lake rings."""
import importlib.util,json,shutil,tempfile,sys
from pathlib import Path
sys.dont_write_bytecode=True
V=Path(__file__).with_name('validate-independent-review.py')
def replace_json(root,rel,fn):
 p=root/rel;x=json.loads(p.read_text());fn(x);p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def run():
 s=importlib.util.spec_from_file_location('v',V);v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
 root=V.parent.parent;baseline=v.validate(root)
 assert baseline['included_ordered_position_count']==66 and baseline['map_judgments_reproduced'] is False
 R='review/independent-review.json';S='research/saskatchewan/';D='geometry-duplicate-check.json'
 cases=[
 ('automatic_application',R,lambda x:x.update(automatic_application=True)),
 ('korean_name',R,lambda x:x['findings'][0].update(name_ko='unverified')),
 ('scalar_name',R,lambda x:x['findings'][0].update(whole_feature_scalar_name='Unverified Lake')),
 ('scalar_clearance',R,lambda x:x['findings'][2].update(whole_polygon_name_application_cleared=True)),
 ('label_only_identity',R,lambda x:x['findings'][2].update(label_overlap_alone_used_as_identity=True)),
 ('live_deployment',R,lambda x:x.update(current_live_deployment_checked=True)),
 ('restored_history',R,lambda x:x.update(historical_verdicts_restored=True)),
 ('fid_domain',R,lambda x:x['findings'][0].update(geometry_fids=[3982])),
 ('target_order',R,lambda x:x['findings'].reverse()),
 ('cumulative_count',R,lambda x:x.update(cumulative_distinct_targets=50)),
 ('assigned_name_swap',R,lambda x:x['findings'][0].update(candidate_name='Steephill Lake')),
 ('scope_hold_erased',R,lambda x:x.update(new_scope_hold_ids=[])),
 ('scope_follow_up_erased',R,lambda x:x['findings'][1].update(follow_up_required=False)),
 ('scope_access_invented',R,lambda x:x['findings'][1].update(source_access_limited=True)),
 ('scope_completion_erased',R,lambda x:x['findings'][1].update(full_feature_correspondence_review_completed=False)),
 ('compound_invented',R,lambda x:x['findings'][1].update(compound_named_waterbody_required_by_evidence=True)),
 ('context_name_promoted',R,lambda x:x['findings'][1].update(candidate_name='Steephill Lake')),
 ('context_form_promoted',R,lambda x:x['findings'][1].update(directly_supported_name_forms=['Steephill Lake'])),
 ('context_label_promoted',R,lambda x:x['findings'][1].update(contextual_label_promoted_to_target_name=True)),
 ('settlement_as_lake',R,lambda x:x['findings'][1].update(settlement_label_promoted_to_water_name=True)),
 ('exhaustive_union',R,lambda x:x['findings'][1].update(constituent_list_exhaustive=True)),
 ('precise_partition',R,lambda x:x['findings'][1].update(exact_name_partition_established=True)),
 ('second_constituent',R,lambda x:x['findings'][1].update(second_named_constituent_established=True)),
 ('cold_pending_erased',R,lambda x:x.update(preserved_pending_access_ids=['lakes_base:1159108815'])),
 ('timiskaming_pending_erased',R,lambda x:x.update(preserved_pending_access_ids=['lakes_base:1159112821'])),
 ('previous_holds_erased',R,lambda x:x.update(preserved_scope_hold_ids=[])),
 ('new_pending_invented',R,lambda x:x.update(new_pending_access_ids=['lakes_base:1159109993'])),
 ('whole_named_lake_extent',R,lambda x:x['findings'][2].update(whole_named_water_extent_verified=True)),
 ('survey_claim',R,lambda x:x['findings'][1].update(exact_shoreline_verified=True)),
 ('historical_judgments_reproduced',R,lambda x:x['historical_review'].update(historical_results_recomputed_by_public_validator=True)),
 ('source_vertex','selected-lake-geometries.geojson',lambda x:x['features'][0]['geometry']['coordinates'][0][5].__setitem__(0,-93)),
 ('baseline_vertex','selected-baseline-rendered-geometries.geojson',lambda x:x['features'][1]['geometry']['coordinates'][0][5].__setitem__(1,31)),
 ('ring_order','selected-baseline-rendered-geometries.geojson',lambda x:x['features'][2]['geometry']['coordinates'][0].reverse()),
 ('missing_target','selected-lake-geometries.geojson',lambda x:x['features'].pop()),
 ('inventory_logical_fid','selected-inventory-records.json',lambda x:x['records'][1].update(logical_fid=15457)),
 ('reference_order','geometry-reference.json',lambda x:x['selected_features'].reverse()),
 ('research_scope',S+'findings.json',lambda x:x['records'][1].update(research_category='supported_generalized_water_identity')),
 ('research_completion_count',S+'findings.json',lambda x:x.update(full_feature_correspondence_review_completed_count=2)),
 ('research_context_as_name',S+'findings.json',lambda x:x['records'][1].update(candidate_name='Steephill Lake')),
 ('research_context_mismatch',S+'findings.json',lambda x:x['records'][2].update(contextual_map_labels=['Unverified Lake'])),
 ('source_fact_count',S+'target-identity-facts.json',lambda x:x['targets'][0].update(source_positions_including_closure=27)),
 ('source_fact_bounds',S+'target-identity-facts.json',lambda x:x['targets'][0]['source_bbox'].__setitem__(0,-80)),
 ('url_date_as_publication',S+'source-evidence.json',lambda x:x['sources'][0].update(publication_date='2025-05')),
 ('multiple_views_as_sources',S+'source-evidence.json',lambda x:x.update(independent_cartographic_identity_source_count=3)),
 ('normalized_election_date',S+'source-evidence.json',lambda x:x['sources'][1].update(publication_date='2023-02-10')),
 ('independent_election_sheets',S+'source-evidence.json',lambda x:x.update(independent_source_count=3)),
 ('election_observation_date','review/source-observations.json',lambda x:x['observations'][1].update(printed_creation_date='2023-10-02')),
 ('new_retrieval_invented',S+'source-evidence.json',lambda x:x['sources'][0].update(retrieved_this_batch=True)),
 ('map_scope_incomplete',S+'map-scope-review.json',lambda x:x['records'][1].update(full_feature_correspondence_review_completed=False)),
 ('source_observation_count','review/source-observations.json',lambda x:x.update(distinct_acquired_publications=2)),
 ('prior_duplicate',D,lambda x:x['previous_aw_ids_in_index_order'].__setitem__(0,'lakes_base:1159108703')),
 ('remaining_queue',D,lambda x:x['current_batch_delta'].update(remaining_fresh_reconstruction_queue_after=4013)),
 ('old_source_reaudit',D,lambda x:x['current_batch_delta'].update(prior_target_geometry_or_naming_revalidation_performed=True)),
 ('first_follow_up_erased',R,lambda x:x['findings'][0].update(follow_up_required=False)),
 ('third_follow_up_erased',R,lambda x:x['findings'][2].update(follow_up_required=False)),
 ('first_name_invented',R,lambda x:x['findings'][0].update(candidate_name='Lac Ile-a-la-Crosse')),
 ('third_name_invented',R,lambda x:x['findings'][2].update(candidate_name='Wood Lake')),
 ('inherited_sandfly_extent',R,lambda x:x['inherited_scope_continuity'].update(whole_named_water_extent_equivalence_claimed=True)),
 ('inherited_sandfly_scope',R,lambda x:x['inherited_scope_continuity'].update(selected_scope='entire lake')),
 ('inherited_sandfly_river_extension',R,lambda x:x['inherited_scope_continuity'].update(connecting_river_name_extension_approved=True)),
 ('inherited_source_reaudit',R,lambda x:x['inherited_scope_continuity'].update(prior_source_geometry_reaudit_performed=True)),
 ]
 rejected=[]
 with tempfile.TemporaryDirectory(prefix='included-r17-review-') as t:
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
