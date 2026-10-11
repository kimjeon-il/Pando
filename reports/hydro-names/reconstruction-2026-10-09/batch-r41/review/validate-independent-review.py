#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted source judgments are not replayed."""
import hashlib,json,re,sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parent
IDS = ['lakes_base:1159110095', 'lakes_base:1159108225', 'lakes_base:1159108715']
NAMES = ['Severn Lake', 'Whitestone Lake', 'Finger Lake']
FIDS = [15465, 15322, 15358]
LOGICAL = [4090, 3947, 3983]
POSITIONS = [24, 25, 36]
LOCATIONS = ['Northern Ontario, Canada, at the elongated Severn Lake body north of Bearbone Lake', 'Northern Ontario, Canada, at Whitestone Lake north of Cat Lake', 'Northern Ontario, Canada, at Finger Lake south of Opasquia Lake and northwest of Sandy Lake']
EXTENT_LIMITS = ['The complete selected generalized ring follows the principal Severn Lake body, including its broad northern cap, west-central shoulder and southern taper. The coarse northern cap crosses mapped land and omits a narrow northern continuation; fine bays, shores and connecting waters are generalized. The entire detailed named-lake extent and exact adjoining-water transitions remain unverified.', 'The complete selected generalized ring corresponds to the principal Whitestone Lake body shown on the West-Central Sheet, including the northern tip, northwestern indentation and western shoulder. There is substantial shoreline mismatch: the coarse rounded southern lobe extends over white mapped land beyond the lake shore, the eastern edge also crosses mapped land, and fine inlets are omitted or crossed. The entire detailed named-lake extent and exact adjoining-water transitions remain unverified. The Northern Sheet alone lacks the needed hydrographic coverage.', 'The complete selected generalized ring follows the Finger Lake body, including its northwestern inlet, northern stepped margin, central basin and eastern cap. The coarse outline includes mapped land between inlets, omits islands and fine bays, and its long southern edge clips a southern lobe. The entire detailed named-lake extent and exact transitions to connecting waters remain unverified.']
OBSERVATIONS = ['Original blue Severn Lake text and pale-cyan water correspond to the complete 24-position selected outline. The northern cap, western shoulder and southern taper were compared with original shores and wider context. Bearbone Lake to the south and Knife Lake to the west are separate contextual waters. Narrow connecting reaches do not establish exact name boundaries; coarse land crossings do not by themselves defeat the generalized association.', 'The West-Central original shows blue Whitestone Lake text on white land east of pale-cyan water through the northern and central selected footprint. All 25 positions were compared with the complete mapped body and wider context. The coarse rounded southern lobe overshoots the mapped shore onto white land; fine western and eastern inlets are generalized. Cat Lake lies separately farther south, beyond intervening water, and is not a selected component. The Northern Sheet text alone was insufficient because its base hydrography stops across this footprint; the newly inspected West-Central original closes that specific material gap.', 'Original blue Finger Lake text spans the pale-cyan main body corresponding to the complete 36-position ring. The northwestern inlet and eastern cap align at generalized scale; the coarse southern edge omits a lobe and northern edges cross land between inlets. Opasquia Lake and Angekum Lake are separate northern waters; Sandy Lake lies southeast beyond connecting water. None is assigned as an alias or selected named component.']
FEATURE_SOURCES = [['ogs_index_bedrock_northern_2021'], ['ogs_index_bedrock_west_central_2021'], ['ogs_index_bedrock_northern_2021']]
CONTEXT_SOURCES = [[], ['ogs_index_bedrock_northern_2021'], []]
PENDING_MATERIAL_INDEXES = []
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '3dd3e5a3fa80e56c7a7dbccbd518d0d7ed074953'
GEOMETRY_FILES = {'geometry-validation.json', 'test-geometry-reference.py', 'geometry-publication-rights.json', 'geometry-component-manifest.json', 'geometry-README.md', 'geometry-duplicate-check.json', 'validate-geometry-reference.py', 'geometry-reference.json', 'selected-inventory-records.json'}
REVIEW_FILES = {'review-manifest.json', 'test-independent-review.py', 'validate-independent-review.py', 'independent-review.json', 'README.md', 'public-input-pins.json', 'review-validation.json', 'source-observations.json'}
DOCUMENTS = {'review': 'review/independent-review.json', 'source': 'review/source-observations.json', 'geometry': 'geometry-reference.json', 'inventory': 'selected-inventory-records.json', 'continuity': 'geometry-duplicate-check.json'}
PUBLICATIONS = [{'source_key': 'ogs_index_bedrock_northern_2021', 'title': 'Index to Maps, Bedrock Geology, 1991–2020, Northern Sheet', 'publisher': 'Ontario Geological Survey', 'url': 'https://www.geologyontario.mndm.gov.on.ca/mines/ogs/indexes/pdfs/INDEX-Bedrock-Northern.pdf', 'original_acquired_at_utc': '2026-10-10T01:44:15.182007+00:00', 'acquisition_http_status': 200, 'original_acquisition_receipt_reviewed': True, 'retrieved_this_batch': False, 'reused_original': True, 'original_map_pixels_viewed': True, 'is_formal_naming_registry': False, 'publication_date': '2021', 'publication_date_precision': 'year', 'publication_date_verified': True, 'publication_date_note': 'The original suggested citation identifies Ontario Geological Survey 2021. Copyright year 2021 is recorded separately. The title interval 1991–2020 describes indexed map coverage; no publication month or day is established.', 'review_reused_original_acquired_earlier_this_batch': False, 'review_reused_original_acquired_in_prior_batch': True, 'original_acquisition_batch': 'r40', 'directly_read_water_labels': ['Severn Lake', 'Whitestone Lake', 'Finger Lake'], 'nearby_distinct_water_labels': ['Bearbone Lake', 'Knife Lake', 'Opasquia Lake', 'Angekum Lake', 'Sandy Lake'], 'physical_pdf_pages': [1], 'role': 'Generalized Severn Lake and Finger Lake associations; readable Whitestone Lake text and missing-coverage context only for the second target.', 'authority_scope': 'Official provincial thematic cartographic usage supports bounded generalized water identity. It is not a formal naming-registry decision and does not certify exact shoreline or name partitions.', 'registered_overlay_performed': True, 'own_observations': 'Original blue Severn Lake text and pale-cyan water correspond to the complete 24-position selected outline. The northern cap, western shoulder and southern taper were compared with original shores and wider context. Bearbone Lake to the south and Knife Lake to the west are separate contextual waters. Narrow connecting reaches do not establish exact name boundaries; coarse land crossings do not by themselves defeat the generalized association. Original blue Finger Lake text spans the pale-cyan main body corresponding to the complete 36-position ring. The northwestern inlet and eastern cap align at generalized scale; the coarse southern edge omits a lobe and northern edges cross land between inlets. Opasquia Lake and Angekum Lake are separate northern waters; Sandy Lake lies southeast beyond connecting water. None is assigned as an alias or selected named component. The Whitestone Lake label is readable, but nearly all selected-footprint hydrography is absent on this sheet. Label proximity alone does not establish the selected-water association.', 'printed_scale': '1:1,000,000', 'cartographic_credit_observed': 'Publication Services Unit, Ontario Geological Survey compiled and edited the index; J. Rose is credited for map outlines and cartographic production. The credits caution that coverage outlines and the topographic base may differ and that editorial review was limited.', 'printed_copyright_year': '2021', 'printed_bibliographic_citation_year': '2021', 'hydrographic_base_provider': None, 'original_requested_at_utc': '2026-10-10T01:44:07.664713+00:00'}, {'source_key': 'ogs_index_bedrock_west_central_2021', 'title': 'Index to Maps, Bedrock Geology, 1991–2020, West-Central Sheet', 'publisher': 'Ontario Geological Survey', 'url': 'https://www.geologyontario.mndm.gov.on.ca/mines/ogs/indexes/pdfs/INDEX-Bedrock-WestCentral.pdf', 'original_acquired_at_utc': '2026-10-10T02:07:35.288175+00:00', 'acquisition_http_status': 200, 'original_acquisition_receipt_reviewed': True, 'retrieved_this_batch': True, 'reused_original': True, 'original_map_pixels_viewed': True, 'is_formal_naming_registry': False, 'publication_date': '2021', 'publication_date_precision': 'year', 'publication_date_verified': True, 'publication_date_note': 'The original suggested citation identifies Ontario Geological Survey 2021. Copyright year 2021 is recorded separately. The title interval 1991–2020 describes indexed map coverage; no publication month or day is established.', 'review_reused_original_acquired_earlier_this_batch': True, 'review_reused_original_acquired_in_prior_batch': False, 'original_acquisition_batch': 'r41', 'directly_read_water_labels': ['Whitestone Lake'], 'nearby_distinct_water_labels': ['Cat Lake'], 'physical_pdf_pages': [1], 'role': 'Original hydrographic coverage closes the second target material gap and supports generalized Whitestone Lake identity with substantial shoreline discrepancy.', 'authority_scope': 'Official provincial thematic cartographic usage supports bounded generalized water identity. It is not a formal naming-registry decision and does not certify exact shoreline or name partitions.', 'registered_overlay_performed': True, 'own_observations': 'The West-Central original shows blue Whitestone Lake text on white land east of pale-cyan water through the northern and central selected footprint. All 25 positions were compared with the complete mapped body and wider context. The coarse rounded southern lobe overshoots the mapped shore onto white land; fine western and eastern inlets are generalized. Cat Lake lies separately farther south, beyond intervening water, and is not a selected component. The Northern Sheet text alone was insufficient because its base hydrography stops across this footprint; the newly inspected West-Central original closes that specific material gap.', 'printed_scale': '1:1,000,000', 'cartographic_credit_observed': 'Publication Services Unit, Ontario Geological Survey compiled and edited the index; J. Rose is credited for map outlines and cartographic production. The credits caution that coverage outlines and the topographic base may differ and that editorial review was limited.', 'printed_copyright_year': '2021', 'printed_bibliographic_citation_year': '2021', 'hydrographic_base_provider': None, 'original_requested_at_utc': '2026-10-10T02:07:26.442841+00:00'}]
REQUEST_COUNT = 3
ACQUISITION_COUNT = 1
REQUEST_ACCOUNTING = {'search_tool_calls': 2, 'search_queries': 2, 'explicit_web_open_requests': 0, 'original_body_requests': 1, 'new_original_bodies_acquired': 1, 'new_source_access_denials': 0, 'new_source_availability_failures': 0, 'stopped_resource_requests': 0, 'additional_source_acquisitions_planned': False}

def load_records():return {k:json.loads((PUBLIC/p).read_text())for k,p in DOCUMENTS.items()}
def verify_bytes(body,pin):assert len(body)==pin['bytes'] and hashlib.sha256(body).hexdigest()==pin['sha256']
def timestamp(value):
 t=datetime.fromisoformat(value.replace('Z','+00:00'));assert t.utcoffset()is not None;return t

def reject_payload(value):
 if isinstance(value,dict):
  for k,v in value.items():
   assert k not in {'coordinates','coordinate_arrays','part_endpoints','cache_dir'}
   assert not any(t in k.lower()for t in ['sha256','fingerprint','checksum'])
   reject_payload(v)
 elif isinstance(value,list):
  for v in value:reject_payload(v)
 elif isinstance(value,str):assert not re.search(r'/(?:workspace|tmp)/|(?:local-review|input-cache)/',value)

def validate_records(data):
 review,source,geometry,inventory,continuity=(data[k]for k in DOCUMENTS);pending=set(PENDING_MATERIAL_INDEXES);complete=3-len(pending)
 reject_payload(review);reject_payload(source)
 for d in [review,source,geometry,continuity]:assert d['batch']=='r41'
 for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
 assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
 stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
 assert review['prior_distinct_targets']==117 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==120 and review['duplicate_targets']==0
 assert review['current_batch_full_feature_correspondence_reviews_completed']==complete
 for k in ['current_batch_source_limited_targets','current_batch_source_material_pending_targets','current_batch_follow_up_required_targets']:assert review[k]==len(pending)
 assert review['current_batch_scope_hold_targets']==review['scalar_product_name_approvals']==0 and review['independent_source_comparison_completed']is True
 for k in ['automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','pending_access_reassessment_performed','prior_target_source_or_geometry_reaudit_performed','private_original_packed_decoder_independently_replayed']:assert review[k]is False
 history=review['historical_review'];assert timestamp(history['performed_at_utc'])==stamp
 assert history['available_source_inspection_completed']is True and history['full_feature_correspondence_review_completed']==(not pending)
 assert history['full_feature_correspondence_review_completed_count']==complete and history['source_material_pending_count']==len(pending)
 for k in ['original_source_material_included','full_selected_geometry_included','historical_results_recomputed_by_public_validator']:assert history[k]is False
 assert source['new_external_requests']==REQUEST_COUNT and source['new_external_requests_by_independent_reviewer']==0 and source['backend_http_subrequest_count']is None and source['new_original_source_acquisitions_this_batch']==ACQUISITION_COUNT
 assert source['external_request_count_unit']=='known_high_level_calls' and source['new_external_requests_scope'] and source['request_accounting']==REQUEST_ACCOUNTING
 assert source['distinct_reviewed_publications']==source['distinct_cartographic_identity_publications']==len(PUBLICATIONS) and source['independent_source_groups']==1
 assert source['independent_review_and_source_research_agree']is True and source['registered_overlay_performed']is True
 for k in ['registration_limit','source_group_definition','source_group_limit']:assert source[k]
 for k in ['underlying_hydrographic_dataset_independence_verified','formal_registry_verified']:assert source[k]is False
 assert len(source['observations'])==len(PUBLICATIONS)
 for p,expected in zip(source['observations'],PUBLICATIONS):
  assert p==expected and timestamp(p['original_acquired_at_utc'])<=stamp
  assert timestamp(p['original_requested_at_utc'])<timestamp(p['original_acquired_at_utc'])
  assert p['publication_date']==p['printed_bibliographic_citation_year']=='2021' and p['publication_date_precision']=='year' and p['publication_date_verified']is True
  assert p['printed_copyright_year']=='2021' and p['hydrographic_base_provider']is None and p['physical_pdf_pages']==[1] and p['printed_scale']=='1:1,000,000'
 columns=[review['findings'],source['complete_feature_observations'],geometry['selected_features'],inventory['records']]
 for col in columns:assert [r['aw_id']for r in col]==IDS
 for i,(f,o,g,row)in enumerate(zip(*columns)):
  material=i in pending
  for x in [f,o,g,row]:assert x['source_id']==IDS[i].split(':')[1]
  assert f['baseline_logical_fid']==g['baseline_logical_fid']==row['logical_fid']==LOGICAL[i] and g['baseline_fid']==FIDS[i]
  for x in [f,o,row]:assert x['geometry_fids']==[FIDS[i]]
  assert f['fragment_count']==g['fragment_count']==row['geometry_count']==1
  for x in [f,o]:assert x['polygon_part_count']==x['ring_count']==1 and x['position_count_including_closure']==POSITIONS[i] and x['all_selected_parts_and_rings_considered']is True
  for k in ['source_geometry','baseline_rendered_geometry']:
   s=g[k];assert s['type']=='Polygon' and s['polygon_part_count']==1 and s['ring_counts_by_part']==[1] and s['coordinate_counts_by_part_and_ring']==[[POSITIONS[i]]] and s['total_coordinates_including_closure']==POSITIONS[i] and s['all_rings_closed']is True
  assert row['bbox']==g['baseline_rendered_geometry']['bbox'] and f['category']==row['category']=='lake'
  assert f['source_keys']==o['source_keys']==FEATURE_SOURCES[i] and f['context_source_keys']==o['context_source_keys']==CONTEXT_SOURCES[i]
  assert f['full_feature_correspondence_review_completed']==(not material) and f['source_and_rendered_full_footprints_compared']is True and o['entire_selected_source_and_rendered_polygons_viewed']is True
  assert f['source_observation_id']==o['observation_id']==f['aw_id'] and o['independent_observation']==OBSERVATIONS[i]
  assert f['supported_name_scope'] and f['limits'] and f['follow_up_scope'] and f['geographic_disambiguation']==LOCATIONS[i]
  assert f['candidate_names']==f['directly_supported_name_forms']==[NAMES[i]] and f['candidate_name']==(None if material else NAMES[i])
  assert f['source_material_pending']==material and f['source_access_limited']is False and f['complete_source_map_coverage_available']==(not material) and f['complete_geometry_inspection_performed']is True
  assert o['source_material_pending']==material and o['complete_source_map_coverage_available']==(not material) and o['full_feature_source_identity_review_completed']==(not material)
  assert f['research_category']==('source_coverage_incomplete'if material else'supported_generalized_water_identity') and f['review_status']==('label_visible_missing_source_coverage'if material else'supported_generalized_identity_with_material_extent_limits') and f['candidate_name_role']==('local_cartographic_label_lead_only'if material else'generalized_research_identity_not_product_scalar')
  assert f['follow_up_required']==material and f['registered_overlay_performed']is True
  c=f['name_confidence'];assert c['direct_label_reading']=='high' and c['local_named_water_association']==('unverified_label_only'if material else'high') and c['whole_selected_single_name']==('unverified_missing_source_coverage'if material else'supported_generalized_identity') and c['exact_named_extent']=='unverified' and c['basis']==OBSERVATIONS[i]
  assert f['selection_origin']=='new_inventory_investigation'
  for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','korean_name','name_en','name_original']:assert f[k]is None
  for k in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified','exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:assert f[k]is False
  s=f['naming_scope_details'];assert s['selected_polygon_count']==1 and s['separately_labelled_water_names']==[NAMES[i]] and s['multiple_named_lakes_in_one_polygon']is False
  for k in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','supported_component_names_exhaustive']:assert s[k]==(not material)
  for k in ['whole_polygon_scalar_application_approved','precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed','component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed','entire_detailed_named_lake_representation_verified']:assert s[k]is False
  assert s['material_extent_limit']==EXTENT_LIMITS[i] and EXTENT_LIMITS[i]in f['supported_name_scope'] and EXTENT_LIMITS[i]in f['limits']
  assert s['unresolved_selected_parts']==[] and s['unresolved_named_extents']==(['Selected-water identity unverified because original hydrographic coverage is missing']if material else[])
  assert s['supported_component_associations']==([]if material else[{'name':NAMES[i],'scope':'Complete selected generalized footprint with stated material extent limits'}])
 assert review['new_scope_hold_ids']==review['new_pending_access_ids']==[] and review['new_pending_material_ids']==[IDS[i]for i in sorted(pending)]
 assert review['preserved_pending_material_ids']==continuity['preserved_pending_material_ids']==['lakes_base:1159109285']
 assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
 assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==36
 previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==117
 preserved=[review[k]for k in ['preserved_scope_hold_ids','preserved_pending_access_ids','preserved_pending_material_ids']]
 assert all(set(preserved[i]).isdisjoint(preserved[j])for i in range(3)for j in range(i))
 assert set(sum(preserved,[]))<=set(previous) and set(previous).isdisjoint(IDS)
 assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
 assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r40/reconstruction-index.json'
 d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==117 and d['reconstructed_target_count_after']==120 and d['initial_eligible_target_count']==4065
 assert d['remaining_fresh_reconstruction_queue_before']==3948 and d['remaining_fresh_reconstruction_queue_after']==3945 and d['remaining_queue_types_after']=={'river_group':3412,'lake':533}
 return {'status':'passed','mode':'included_public_files_only','batch':'r41','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':85,'recorded_full_feature_correspondence_reviews_completed':complete,'new_scope_hold_ids':[],'new_pending_access_ids':[],'new_pending_material_ids':[IDS[i]for i in sorted(pending)],'generalized_water_identities_supported':complete,'bounded_partial_name_associations':0,'label_only_material_pending':len(pending),'unnamed_identity_extent_holds':0,'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':120,'recorded_target_types':{'river_group':43,'lake':77},'remaining_unrecorded_targets':3945,'cumulative_scope_hold_count':36,'pending_access_count':2,'pending_material_count':1+len(pending),'pending_any_count':3+len(pending),'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Access, material and naming-scope states remain distinct. Exact extents and product naming remain unapproved.'}


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r41' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r41' and manifest['scope'] == 'included_public_files_only'
    assert manifest['scope_aw_ids'] == IDS and manifest['manifest_excludes_itself'] is True
    assert manifest['review_file_count_including_manifest'] == len(REVIEW_FILES) and manifest['automatic_application'] is False
    assert {path.name for path in HERE.iterdir()} == REVIEW_FILES
    assert len(manifest['files']) == len(REVIEW_FILES) - 1
    assert {item['file'] for item in manifest['files']} == REVIEW_FILES - {'review-manifest.json'}
    for item in manifest['files']:
        path = HERE / item['file']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    records = load_records()
    result = validate_records(records)
    validation = json.loads((HERE / 'review-validation.json').read_text())
    assert timestamp(manifest['frozen_at_utc']) >= timestamp(validation['validated_at_utc']) >= timestamp(records['review']['reviewed_at_utc'])
    assert validation['validation'] == result and validation['status'] == validation['tests']['status'] == 'passed'
    assert validation['mode'] == 'included_public_files_only' and validation['tests']['network_requests'] == 0
    assert validation['tests']['original_map_or_full_polygon_or_decoder_judgments_reproduced'] is False
    return result


if __name__ == '__main__':
    print(json.dumps(validate_public(), indent=2))
