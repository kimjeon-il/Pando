#!/usr/bin/env python3
"""Validate finite included public records; omitted source/path judgments are not replayed."""
import collections, hashlib, json, sys
from datetime import datetime
from pathlib import Path
sys.dont_write_bytecode = True
HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parent
IDS=['hydro-system:50458725','hydro-system:50487926','hydro-system:50503092']
FIDS=[[6699,6700],[6746,6747],[6776,6777]]
LOGICAL=[1800,1831,1847]
PARTS=[60,40,74]
POSITIONS=[401,169,455]
SOURCE='bom_australian_water_resources_assessment_2012'
GEOMETRY_FILES={'geometry-reference.json','selected-river-metadata.json','selected-inventory-records.json','geometry-duplicate-check.json','geometry-publication-rights.json','geometry-README.md','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json','geometry-component-manifest.json'}
REVIEW_FILES={'README.md','independent-review.json','source-observations.json','public-input-pins.json','review-validation.json','review-manifest.json','validate-independent-review.py','test-independent-review.py'}
DOCUMENTS={'review':'review/independent-review.json','source':'review/source-observations.json','geometry':'geometry-reference.json','metadata':'selected-river-metadata.json','inventory':'selected-inventory-records.json','continuity':'geometry-duplicate-check.json'}
def load_records():return {k:json.loads((PUBLIC/p).read_text())for k,p in DOCUMENTS.items()}
def verify_bytes(body,pin):assert len(body)==pin['bytes'] and hashlib.sha256(body).hexdigest()==pin['sha256']
def timestamp(v):
 d=datetime.fromisoformat(v.replace('Z','+00:00'));assert d.utcoffset()is not None;return d
def reject_omitted_payload(v):
 if isinstance(v,dict):
  for k,c in v.items():
   assert k not in {'coordinates','coordinate_arrays','part_endpoints','cache_dir'}
   assert not any(t in k.lower()for t in ['sha256','fingerprint','checksum'])
   reject_omitted_payload(c)
 elif isinstance(v,list):
  for c in v:reject_omitted_payload(c)
def validate_records(d):
 review,source,geometry,metadata,inventory,continuity=(d[k]for k in DOCUMENTS)
 reject_omitted_payload(review);reject_omitted_payload(source)
 for x in [review,source,geometry]:assert x['batch']=='r27'
 for x in [review,source,geometry,metadata,inventory]:assert x['scope_aw_ids']==IDS
 assert review['baseline_commit']==geometry['baseline']['git_commit']=='fd6744f5e72a0c1a107452dbde6d416ab57237db'
 stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
 assert review['prior_distinct_targets']==78 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==81 and review['duplicate_targets']==0
 for k in ['automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','original_hydrorivers_coordinate_equality_verified','all_reach_names_verified','pending_access_reassessment_performed','prior_target_source_or_geometry_reaudit_performed']:assert review[k]is False
 assert review['scalar_product_name_approvals']==0
 history=review['historical_review'];assert timestamp(history['performed_at_utc'])==stamp
 assert history['available_source_inspection_completed']is True and history['full_feature_correspondence_review_completed']is True
 for k in ['original_source_material_included','full_selected_geometry_included','historical_results_recomputed_by_public_validator']:assert history[k]is False
 assert source['new_external_requests']==0
 for k in ['distinct_supporting_publications','distinct_cartographic_identity_publications','independent_source_groups']:assert source[k]==1
 for k in ['underlying_hydrographic_dataset_independence_verified','formal_registry_verified','registered_overlay_performed','exact_surveyed_mouth_verified']:assert source[k]is False
 assert len(source['observations'])==1
 pub=source['observations'][0];assert pub['source_key']==SOURCE
 assert pub['url']=='https://www.bom.gov.au/water/awra/2012/documents/assessment-lr.pdf'
 assert pub['title']=='Australian Water Resources Assessment 2012'and pub['publication_year']==2013 and pub['assessment_year']==2012
 assert pub['retrieved_this_batch']is False and pub['reused_original']is True and pub['original_map_pixels_viewed']is True and pub['is_formal_naming_registry']is False
 assert timestamp(pub['original_acquired_at_utc'])<=stamp
 assert pub['figures'] and all(f['physical_pdf_page']>0 and f['scope']for f in pub['figures'])
 columns=[review['findings'],source['complete_group_observations'],geometry['groups'],inventory['records']]
 for c in columns:assert [x['aw_id']for x in c]==IDS
 for i,(f,o,g,row)in enumerate(zip(*columns)):
  for x in [f,g,row]:assert x['system_id']==IDS[i].split(':')[1]and x['logical_fid']==LOGICAL[i]
  for x in [f,o,g,row]:assert x['geometry_fids']==FIDS[i]
  for x in [f,o,g]:assert x['fragment_count']==2 and x['part_count']==PARTS[i]and x['position_count']==POSITIONS[i]
  fs=[x for x in metadata['fragments']if x['aw_id']==IDS[i]]
  assert len(fs)==2 and [x['fid']for x in fs]==FIDS[i]and [x['fragment_index']for x in fs]==[0,1]
  assert [x['part_count']for x in fs]==g['fragment_part_counts']and [x['position_count']for x in fs]==g['fragment_position_counts']
  assert sum(x['part_count']for x in fs)==PARTS[i]and sum(x['position_count']for x in fs)==POSITIONS[i]
  assert f['baseline_fragment_roles']==g['role_sequence']==['mainstem','mainstem']
  assert f['baseline_stage_sequence']==[x['stage']for x in fs]
  assert f['source_keys']==[SOURCE]and f['source_access_limited']is False and f['full_feature_correspondence_review_completed']is True
  assert f['supported_name_scope']==o['independent_observation']and f['supported_name_scope']and f['limits']
  assert o['entire_selected_baseline_group_viewed']is True and o['all_selected_branches_considered']is True
  assert f['geographic_disambiguation']=='Queensland, Australia'and 'Queensland' in f['supported_name_scope']
  assert f['reach_level_naming_follow_up_required_before_product_application']is True and f['regional_associations_are_exact_reach_assignments']is False
  assert f['complete_baseline_group_compared']is True and f['all_selected_branches_considered']is True
  for k in ['whole_group_scalar_name','scalar_product_name','name_ko','name_en','name_original']:assert f[k]is None
  for k in ['automatic_application','product_application','scalar_product_name_approved','whole_group_scalar_application_approved','whole_reach_name_application_cleared','all_reach_names_verified','uniform_river_name_for_group','formal_registry_verified','exact_source_reach_name_transitions_verified','exact_surveyed_mouth_verified','topology_repaired','label_overlap_alone_used_as_identity','catchment_title_alone_used_as_identity']:assert f[k]is False
  if f['research_category']=='supported_representative_system_identity':
   assert f['candidate_name']in f['directly_supported_name_forms']and f['follow_up_required']is False
   assert f['candidate_name_role']=='bounded_representative_system_identity'
  else:
   assert f['research_category']=='river_group_name_scope_hold'and not f['directly_supported_name_forms']and f['follow_up_required']is True
   assert f['candidate_name_role']=='geographic_candidate_only_scope_hold'
 holds=[f['aw_id']for f in review['findings']if f['research_category']=='river_group_name_scope_hold']
 follow=[f['aw_id']for f in review['findings']if f['follow_up_required']]
 assert review['new_scope_hold_ids']==holds and review['new_pending_access_ids']==[]
 assert review['current_batch_scope_hold_targets']==len(holds)and review['current_batch_follow_up_required_targets']==len(follow)
 assert review['current_batch_full_feature_correspondence_reviews_completed']==3 and review['current_batch_source_limited_targets']==0
 assert review['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
 assert len(review['preserved_scope_hold_ids'])==22 and len(set(review['preserved_scope_hold_ids']))==22
 assert {'hydro-system:50738894','hydro-system:50691388','hydro-system:50443984','hydro-system:50442438','hydro-system:50442579'}<=set(review['preserved_scope_hold_ids'])
 assert not(set(IDS)&set(continuity['previous_aw_ids_in_index_order']))and len(continuity['previous_aw_ids_in_index_order'])==78
 return {'status':'passed','mode':'included_public_files_only','batch':'r27','scope_aw_ids':IDS,'recorded_fragment_count':6,'recorded_part_count':174,'recorded_position_count':1025,'recorded_full_feature_correspondence_reviews_completed':3,'representative_system_identities_supported':3-len(holds),'current_scope_hold_ids':holds,'current_source_limited_targets':0,'recorded_cumulative_distinct_targets':81,'remaining_unrecorded_targets':3984,'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_paths_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and file consistency only; omitted source, map, full-path and decoder judgments are recorded, not reproduced.'}
def validate_public():
 pins=json.loads((HERE/'public-input-pins.json').read_text());assert pins['batch']=='r27'and pins['scope']=='included_public_files_only'
 assert {x['path']for x in pins['files']}==GEOMETRY_FILES
 for x in pins['files']:verify_bytes((PUBLIC/x['path']).read_bytes(),x)
 manifest=json.loads((HERE/'review-manifest.json').read_text());assert manifest['batch']=='r27'and manifest['scope']=='included_public_files_only'
 assert set(p.name for p in HERE.iterdir())==REVIEW_FILES
 assert {x['file']for x in manifest['files']}==REVIEW_FILES-{'review-manifest.json'}
 for x in manifest['files']:verify_bytes((HERE/x['file']).read_bytes(),x)
 result=validate_records(load_records());validation=json.loads((HERE/'review-validation.json').read_text())
 assert validation['validation']==result and validation['status']=='passed'and validation['tests']['status']=='passed'
 return result
if __name__=='__main__':print(json.dumps(validate_public(),indent=2))
