#!/usr/bin/env python3
"""Validate included reassessment facts only; omitted map/path judgments are not replayed."""
import hashlib,json,sys
from datetime import datetime
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent;PUBLIC=HERE.parent
IDS=['hydro-system:50691388','hydro-system:50738894'];FIDS=[[6979],[7043]];LOGICAL=[2023,2085];PARTS=[30,29];POSITIONS=[258,192]
SOURCE='bom_australian_water_resources_assessment_2012'
GEOMETRY_FILES={'geometry-reference.json','selected-river-metadata.json','selected-inventory-records.json','geometry-duplicate-check.json','geometry-publication-rights.json','geometry-README.md','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json','geometry-component-manifest.json'}
REVIEW_FILES={'README.md','independent-review.json','source-observations.json','public-input-pins.json','review-validation.json','review-manifest.json','validate-independent-review.py','test-independent-review.py'}
DOCUMENTS={'review':'review/independent-review.json','source':'review/source-observations.json','geometry':'geometry-reference.json','metadata':'selected-river-metadata.json','inventory':'selected-inventory-records.json','continuity':'geometry-duplicate-check.json'}
def load_records():return {k:json.loads((PUBLIC/p).read_text())for k,p in DOCUMENTS.items()}
def verify_bytes(body,p):assert len(body)==p['bytes']and hashlib.sha256(body).hexdigest()==p['sha256']
def timestamp(v):
 d=datetime.fromisoformat(v.replace('Z','+00:00'));assert d.utcoffset()is not None;return d
def reject_payload(v):
 if isinstance(v,dict):
  for k,c in v.items():
   assert k not in {'coordinates','coordinate_arrays','part_endpoints','cache_dir'}and not any(t in k.lower()for t in ['sha256','fingerprint','checksum']);reject_payload(c)
 elif isinstance(v,list):
  for c in v:reject_payload(c)
def validate_records(d):
 rv,source,geom,meta,inv,continuity=(d[k]for k in DOCUMENTS);reject_payload(rv);reject_payload(source)
 for x in [rv,source,geom]:assert x['batch']=='r28'
 for x in [rv,source,geom,meta,inv]:assert x['scope_aw_ids']==IDS
 assert rv['baseline_commit']==geom['baseline']['git_commit']=='fd6744f5e72a0c1a107452dbde6d416ab57237db'
 stamp=timestamp(rv['reviewed_at_utc']);timestamp(geom['created_at_utc'])
 assert rv['prior_distinct_targets']==rv['cumulative_distinct_targets']==81 and rv['current_batch_increment']==0 and rv['current_batch_reassessed_targets']==2 and rv['duplicate_targets']==0
 assert rv['selected_existing_targets_reassessed']is True and rv['unselected_prior_target_source_or_geometry_reaudit_performed']is False
 for k in ['automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','original_hydrorivers_coordinate_equality_verified','all_reach_names_verified','pending_access_reassessment_performed']:assert rv[k]is False
 assert rv['scalar_product_name_approvals']==0
 hist=rv['historical_review'];assert timestamp(hist['performed_at_utc'])==stamp
 assert hist['available_source_inspection_completed']is True and hist['full_feature_correspondence_review_completed']is True
 for k in ['original_source_material_included','full_selected_geometry_included','historical_results_recomputed_by_public_validator']:assert hist[k]is False
 assert source['successful_new_source_edition_acquisitions']==1
 for k in ['distinct_supporting_publications','distinct_cartographic_identity_publications','independent_source_groups']:assert source[k]==1
 for k in ['underlying_hydrographic_dataset_independence_verified','formal_registry_verified','registered_overlay_performed','exact_surveyed_mouth_verified']:assert source[k]is False
 pubs=[x for x in source['observations']if x['url']=='https://www.bom.gov.au/water/awra/2012/documents/southeastcoastnsw-hr.pdf'];assert len(pubs)==1
 pub=pubs[0];assert pub['source_key']==SOURCE and pub['publication_year']==2013 and pub['assessment_year']==2012
 assert pub['retrieved_this_batch']is True and pub['reused_original']is False and pub['original_map_pixels_viewed']is True and pub['is_formal_naming_registry']is False
 assert timestamp(pub['original_acquired_at_utc'])<=stamp and pub['figures']
 columns=[rv['findings'],source['complete_group_observations'],geom['groups'],inv['records']]
 for c in columns:assert [x['aw_id']for x in c]==IDS
 for i,(f,o,g,row)in enumerate(zip(*columns)):
  for x in [f,g,row]:assert x['logical_fid']==LOGICAL[i]and x['system_id']==IDS[i].split(':')[1]
  for x in [f,o,g,row]:assert x['geometry_fids']==FIDS[i]
  for x in [f,o,g]:assert x['fragment_count']==1 and x['part_count']==PARTS[i]and x['position_count']==POSITIONS[i]
  fs=[x for x in meta['fragments']if x['aw_id']==IDS[i]];assert len(fs)==1 and fs[0]['fid']==FIDS[i][0]
  assert fs[0]['part_count']==PARTS[i]and fs[0]['position_count']==POSITIONS[i]and fs[0]['fragment_index']==0
  assert f['baseline_fragment_roles']==g['role_sequence']==['mainstem']and f['baseline_stage_sequence']==[3]
  assert f['source_keys']==[SOURCE]and f['source_access_limited']is False and f['full_feature_correspondence_review_completed']is True
  assert f['supported_name_scope']==o['independent_observation']and f['supported_name_scope']and f['limits']
  assert o['entire_selected_baseline_group_viewed']is True and o['all_selected_branches_considered']is True
  assert f['geographic_disambiguation']=='New South Wales, Australia'and 'New South Wales' in f['supported_name_scope']
  assert f['reach_level_naming_follow_up_required_before_product_application']is True and f['regional_associations_are_exact_reach_assignments']is False
  assert f['complete_baseline_group_compared']is True and f['all_selected_branches_considered']is True
  for k in ['whole_group_scalar_name','scalar_product_name','name_ko','name_en','name_original']:assert f[k]is None
  for k in ['automatic_application','product_application','scalar_product_name_approved','whole_group_scalar_application_approved','whole_reach_name_application_cleared','all_reach_names_verified','uniform_river_name_for_group','formal_registry_verified','exact_source_reach_name_transitions_verified','exact_surveyed_mouth_verified','topology_repaired','label_overlap_alone_used_as_identity','catchment_title_alone_used_as_identity']:assert f[k]is False
  if f['research_category']=='supported_representative_system_identity':assert f['candidate_name']in f['directly_supported_name_forms']and f['follow_up_required']is False
  else:assert f['research_category']=='river_group_name_scope_hold'and not f['directly_supported_name_forms']and f['follow_up_required']is True
 holds=[f['aw_id']for f in rv['findings']if f['research_category']=='river_group_name_scope_hold']
 assert rv['resolved_prior_scope_hold_ids']==[x for x in IDS if x not in holds]
 assert rv['retained_prior_scope_hold_ids']==[x for x in rv['prior_scope_hold_ids']if x not in rv['resolved_prior_scope_hold_ids']] and set(holds)<=set(rv['retained_prior_scope_hold_ids'])
 assert rv['new_scope_hold_ids']==[]and rv['new_pending_access_ids']==[]
 assert len(rv['prior_scope_hold_ids'])==24 and set(IDS)<=set(rv['prior_scope_hold_ids'])
 assert rv['current_batch_scope_hold_targets']==len(holds)and rv['current_batch_full_feature_correspondence_reviews_completed']==2 and rv['current_batch_source_limited_targets']==0
 assert rv['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
 return {'status':'passed','mode':'included_public_files_only','batch':'r28','scope_aw_ids':IDS,'recorded_fragment_count':2,'recorded_part_count':59,'recorded_position_count':450,'recorded_full_feature_correspondence_reviews_completed':2,'retained_scope_hold_ids':holds,'representative_system_identities_supported':2-len(holds),'distinct_target_increment':0,'existing_targets_reassessed':2,'recorded_cumulative_distinct_targets':81,'remaining_unrecorded_targets':3984,'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_paths_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Source/map/path judgments are recorded, not replayed. Two old IDs are reassessed without increasing distinct coverage.'}
def validate_public():
 pins=json.loads((HERE/'public-input-pins.json').read_text());assert pins['batch']=='r28'and pins['scope']=='included_public_files_only'and {x['path']for x in pins['files']}==GEOMETRY_FILES
 for x in pins['files']:verify_bytes((PUBLIC/x['path']).read_bytes(),x)
 manifest=json.loads((HERE/'review-manifest.json').read_text());assert manifest['batch']=='r28'and manifest['scope']=='included_public_files_only'
 assert set(p.name for p in HERE.iterdir())==REVIEW_FILES and {x['file']for x in manifest['files']}==REVIEW_FILES-{'review-manifest.json'}
 for x in manifest['files']:verify_bytes((HERE/x['file']).read_bytes(),x)
 result=validate_records(load_records());v=json.loads((HERE/'review-validation.json').read_text());assert v['validation']==result and v['status']=='passed'and v['tests']['status']=='passed';return result
if __name__=='__main__':print(json.dumps(validate_public(),indent=2))
