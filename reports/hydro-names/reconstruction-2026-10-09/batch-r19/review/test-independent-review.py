#!/usr/bin/env python3
"""Bounded mutation tests of included summaries; no omitted evidence is replayed."""
import importlib.util,json,shutil,sys,tempfile
from pathlib import Path
sys.dont_write_bytecode=True
V=Path(__file__).with_name('validate-independent-review.py')
def change(root,relative,fn):
 p=root/relative;x=json.loads(p.read_bytes());fn(x);p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def run():
 spec=importlib.util.spec_from_file_location('public_review_validator',V);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);root=V.parent.parent;baseline=v.validate(root)
 assert baseline['status']=='passed' and all(baseline[k] is False for k in ['map_judgments_reproduced','omitted_full_paths_recomputed','original_decoder_replayed','original_source_material_reopened','all_reach_names_verified','automatic_application','product_application'])
 R='review/independent-review.json';S='research/queensland/';D='geometry-duplicate-check.json';O='review/source-observations.json'
 cases=[
 ('automatic_application',R,lambda x:x.update(automatic_application=True)),
 ('product_application',R,lambda x:x.update(product_application=True)),
 ('scalar_name',R,lambda x:x['findings'][0].update(whole_group_scalar_name='Burdekin River')),
 ('korean_name',R,lambda x:x['findings'][0].update(name_ko='unverified')),
 ('all_reaches_named',R,lambda x:x['findings'][1].update(all_reach_names_verified=True)),
 ('uniform_mainstem_name',R,lambda x:x['findings'][2].update(uniform_river_name_for_group=True)),
 ('formal_registry',R,lambda x:x['findings'][1].update(formal_registry_verified=True)),
 ('exact_mouth',R,lambda x:x['findings'][1].update(exact_surveyed_mouth_verified=True)),
 ('catchment_title_only',R,lambda x:x['findings'][2].update(catchment_title_alone_used_as_identity=True)),
 ('role_as_name',R,lambda x:x['findings'][2].update(regional_associations_are_exact_reach_assignments=True)),
 ('topology_repair',R,lambda x:x.update(topology_repaired=True)),
 ('target_order',R,lambda x:x['findings'].reverse()),
 ('wrong_fid_domain',R,lambda x:x['findings'][0].update(geometry_fids=[1859])),
 ('missing_branch',R,lambda x:x['findings'][2].update(all_selected_branches_considered=False)),
 ('wrong_count',R,lambda x:x['findings'][1].update(position_count=780)),
 ('naming_upgrade',R,lambda x:x['findings'][0].update(research_category='all_reaches_verified')),
 ('extra_whole_group_hold',R,lambda x:x.update(new_scope_hold_ids=['hydro-system:50464082'])),
 ('lost_conditional_follow_up',R,lambda x:x['findings'][0].update(follow_up_scope='')),
 ('false_access_pending',R,lambda x:x['findings'][1].update(source_access_limited=True)),
 ('incomplete_bounded_review',R,lambda x:x['findings'][2].update(full_feature_correspondence_review_completed=False)),
 ('unrelated_task_follow_up',R,lambda x:x['findings'][0].update(follow_up_required=True)),
 ('future_product_work_erased',R,lambda x:x['findings'][0].update(reach_level_naming_follow_up_required_before_product_application=False)),
 ('private_judgment_reproduced',R,lambda x:x['historical_review'].update(historical_results_recomputed_by_public_validator=True)),
 ('omitted_geometry_claimed_included',R,lambda x:x['historical_review'].update(full_selected_geometry_included=True)),
 ('past_source_reaudit',R,lambda x:x.update(prior_target_source_or_geometry_reaudit_performed=True)),
 ('pending_access_erased',R,lambda x:x.update(preserved_pending_access_ids=[])),
 ('prior_hold_erased',R,lambda x:x['preserved_scope_hold_ids'].pop()),
 ('sandfly_whole_lake',R,lambda x:x['inherited_scope_continuity'][0].update(supported_name_scope='The entire named lake.')),
 ('ohrid_candidate_upgraded',R,lambda x:x['inherited_scope_continuity'][1].update(research_category='supported_generalized_water_identity')),
 ('prespa_candidate_upgraded',R,lambda x:x['inherited_scope_continuity'][2]['naming_scope_details'].update(directly_supported_name_forms=['Great Prespa'])),
 ('small_prespa_invented',R,lambda x:x['inherited_scope_continuity'][3].update(candidate_name='Small Prespa')),
 ('multiple_views_counted_independently',O,lambda x:x.update(independent_source_groups=5)),
 ('report_year_confused',O,lambda x:x['observations'][0].update(publication_year=2012)),
 ('false_new_acquisition',O,lambda x:x['observations'][0].update(retrieved_this_batch=True)),
 ('wrong_figure_page',O,lambda x:x['observations'][0]['figures'][2].update(physical_pdf_page=109)),
 ('direct_lower_label_dropped',S+'source-evidence.json',lambda x:x['sources'][0]['short_direct_channel_labels'].remove('Burdekin R.')),
 ('source_follow_up_erased',S+'findings.json',lambda x:x['records'][0].update(follow_up_scope='')),
 ('source_status_changed',S+'findings.json',lambda x:x['records'][1].update(follow_up_required=True)),
 ('source_uniform_name',S+'findings.json',lambda x:x['records'][2].update(whole_group_scalar_name='Mitchell River')),
 ('source_corridor_as_exact_reach',S+'findings.json',lambda x:x['records'][2]['component_associations'][1].update(exact_reach_assignment=True)),
 ('unnamed_feeder_invented',S+'findings.json',lambda x:x['records'][0]['component_associations'][1].update(name='Suttor')),
 ('northern_feeder_invented',S+'findings.json',lambda x:x['records'][2]['component_associations'][3].update(name='Alice')),
 ('source_role_mainstem_named',S+'findings.json',lambda x:x['records'][1]['component_associations'][1].update(name='Gilbert')),
 ('source_incomplete_geometry',S+'target-identity-facts.json',lambda x:x['targets'][0].update(complete_baseline_coordinate_count=1000)),
 ('source_fact_omitted_branch',S+'target-identity-facts.json',lambda x:x['targets'][2]['fragments'].pop()),
 ('source_map_registration',S+'map-scope-review.json',lambda x:x.update(map_graticule_or_control_point_registration_performed=True)),
 ('source_map_incomplete',S+'map-scope-review.json',lambda x:x['records'][1].update(full_feature_correspondence_review_completed=False)),
 ('original_equality_claimed','geometry-reference.json',lambda x:x['original_hydrorivers_geometry'].update(source_coordinate_equality_verified=True)),
 ('geometry_original_replayed','geometry-reference.json',lambda x:x['historical_private_verification'].update(public_validator_reproduces_these_omitted_input_checks=True)),
 ('geometry_role_swapped','selected-river-metadata.json',lambda x:x['fragments'][6].update(role='mainstem')),
 ('summary_count_corruption','selected-river-metadata.json',lambda x:x['fragments'][0]['position_counts_by_part'].__setitem__(0,20)),
 ('inventory_group_id_corruption','selected-inventory-records.json',lambda x:x['records'][0].update(logical_fid=6789)),
 ('prior_duplicate',D,lambda x:x['previous_aw_ids_in_index_order'].__setitem__(0,'hydro-system:50517279')),
 ('remaining_queue_error',D,lambda x:x['current_batch_delta'].update(remaining_fresh_reconstruction_queue_after=4009)),
 ('remaining_river_error',D,lambda x:x['current_batch_delta']['remaining_queue_types_after'].update(river_group=3437)),
 ('prior_reaudit_invented',D,lambda x:x.update(scope_hold_reassessment_performed=True)),
 ('raw_paths_added',R,lambda x:x.update(coordinates=[[141,19],[142,20]])),
 ('omitted_body_fingerprint_added',O,lambda x:x['observations'][0].update(source_body_sha256='0'*64))
 ]
 results=[]
 names=v.input_names()+['review/'+n for n in v.REVIEW_NAMES+['review-manifest.json']]
 with tempfile.TemporaryDirectory(prefix='r19-public-review-') as tmp:
  copied=Path(tmp)/'included';copied.mkdir()
  for n in names:
   dest=copied/n;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/n,dest)
  for name,relative,fn in cases:
   original=(copied/relative).read_bytes();change(copied,relative,fn)
   try:v.validate_content(copied)
   except (ValueError,KeyError,TypeError,IndexError):results.append(dict(test=name,status='rejected'))
   else:raise AssertionError('Mutation accepted: '+name)
   finally:(copied/relative).write_bytes(original)
  target=copied/'review/source-observations.json';target.write_bytes(target.read_bytes()+b' ')
  try:v.validate(copied)
  except ValueError:results.append(dict(test='included_file_hash_tamper',status='rejected'))
  else:raise AssertionError('Included byte tamper accepted')
 return dict(status='passed',mode='included_public_files_only',baseline=baseline,mutation_test_count=len(results),mutations=results,network_requests=0,original_map_or_full_path_or_decoder_judgments_reproduced=False,limit='Tests verify included records and expected rejection of public-record mutations only; omitted original maps, paths and private decoder inputs are not reopened or reconstructed.')
if __name__=='__main__':
 try:print(json.dumps(run(),indent=2))
 except Exception as e:print(json.dumps(dict(status='failed',error=str(e)),indent=2));sys.exit(1)
