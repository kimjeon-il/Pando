#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted source judgments are not replayed."""
import hashlib,json,re,sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parent
IDS = ['lakes_base:1159109407', 'lakes_base:1159110033', 'lakes_base:1159107185']
NAMES = [['Northern Indian Lake'], [], []]
FEATURE_SOURCES = [['manitoba_bedrock_geology_of2024_4'], [], []]
CONTEXT_SOURCES = [[], ['manitoba_bedrock_geology_of2024_4'], ['manitoba_bedrock_geology_of2024_4']]
LOCATIONS = ['Northern Manitoba, Canada, at the Northern Indian Lake basin northeast of Thorsteinson Lake', 'Eastern Manitoba, Canada, at an unlabelled compact mapped lake northwest of the Cobham River label and south of Gunisao River', 'Western Manitoba, Canada, at a tiny inventory sliver just east of the provincial border near the 57-degree graticule']
EXTENT_LIMITS = ["The complete generalized ring follows the central, northern and eastern Northern Indian Lake basin with a short western spur. Its southwest margin reaches the connection toward Thorsteinson Lake but stops before that separately labelled lake's long southern basin. The north tip stops south of the Oldman River reach and the east tip stops before the narrow continuation toward Fidler Lake. Coarse margins include geological land and islands while omitting bays and southern water. Exact lake/river transitions, the Northern Indian/Thorsteinson name division and the entire detailed named-lake extent remain unverified.", 'No name is established for the complete selected compact footprint. Its 19-position ring overlaps only the western part of an unlabelled mapped lake, overshoots geological land to the north and west, and omits eastern and southern water. A narrow southern line connects toward the Cobham River-labelled corridor; Gunisao River lies farther north. Neither connecting-water label identifies the complete selected lake. Readable whole-footprint context supports a completed identity/extent hold, with exact named-water boundaries unresolved. The absence of a label on this map does not establish officially unnamed status.', 'The actual five-position geometry is a tiny triangular sliver with three distinct vertices, a consecutive duplicate and closure. The retained regional map places it over land-colored cartography beside narrow mapped water, but its scale cannot resolve whether the sliver corresponds to a water feature or establish its name. Nearby Reindeer Lake and McMillan Lake labels remain context only. Geographic page coverage does not provide sufficient whole-feature source resolution; better original material is required before identity review can be completed.']
OBSERVATIONS = ['Fresh original pixels and all 41 independently registered positions associate the central, northern and eastern basin and short western spur with the Northern Indian Lake label. White blue-shored water is distinct from peach, green and grey geological land. The southwestern edge ends at the connecting-water area before the long Thorsteinson southern basin, the northern tip stops below Oldman River, and the eastern tip does not follow the long continuation toward Fidler Lake. Coarse edges overshoot land, include islands and omit shoreline water. One generalized research identity is supported; exact lake/river and adjoining-lake name boundaries are unverified.', 'Fresh original pixels and all 19 registered positions show the selected ring overlapping the western part of a compact unlabelled white lake amid purple and tan geological land. Much of the northern and western footprint lies over mapped land, while eastern and southern water is omitted. The southern connecting line leads toward the Cobham River context; Gunisao River is farther north. No direct target-water label is established and neither river name is assigned. Full readable context supports a completed unnamed identity/extent hold rather than source-material or access pending.', "Fresh source and rendered rings confirm five ordered positions but only three distinct vertices, including a consecutive duplicate and closure. All five are independently registered near the provincial border over orange geological pixels beside a narrow blue-shored white-water feature. The regional original cannot resolve the sliver's actual water association, even when magnified. Land-colored placement is not evidence that water is absent. Reindeer Lake and McMillan Lake are nearby labels, not supported target candidates. Complete geometry inspection is finished, but whole-feature source identity review remains material-pending; no source access denial occurred."]
ASSOCIATIONS = [[{'name': 'Northern Indian Lake', 'scope': 'Complete selected generalized footprint with stated material extent limits'}], [], []]
UNRESOLVED = [[], ['Whole selected compact footprint: water identity and relation to the nearby Cobham River corridor remain unnamed and unverified'], ['Whole tiny selected sliver: regional source resolution is insufficient for water association and naming']]
FIDS = [15415, 15460, 15246]
LOGICAL = [4040, 4085, 3871]
POSITIONS = [41, 19, 5]
HOLD_INDEXES = [1]
PENDING_MATERIAL_INDEXES = [2]
CATEGORIES = ['supported_generalized_water_identity', 'candidate_waterbody_identity_extent_hold', 'source_material_insufficient']
STATUSES = ['supported_generalized_identity_with_material_extent_limits', 'unresolved_water_identity_and_extent_scalar_name_hold', 'unresolved_identity_insufficient_source_resolution']
ROLES = ['generalized_research_identity_not_product_scalar', 'no_named_candidate_established_for_selected_water', 'no_named_candidate_established_insufficient_source_resolution']
DIRECT = ['high', 'no_selected_water_label_established', 'no_selected_water_label_established']
LOCAL = ['high', 'unresolved', 'unverified_insufficient_source_resolution']
WHOLE = ['supported_generalized_identity', 'unresolved_identity_and_extent', 'unverified_insufficient_source_resolution']
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '016c07abf63e780bf48374db539cc82ee4c6c0cd'
GEOMETRY_FILES = {'geometry-reference.json', 'geometry-README.md', 'validate-geometry-reference.py', 'geometry-publication-rights.json', 'geometry-validation.json', 'geometry-component-manifest.json', 'geometry-duplicate-check.json', 'test-geometry-reference.py', 'selected-inventory-records.json'}
REVIEW_FILES = {'independent-review.json', 'review-manifest.json', 'test-independent-review.py', 'validate-independent-review.py', 'source-observations.json', 'README.md', 'public-input-pins.json', 'review-validation.json'}
DOCUMENTS = {'review': 'review/independent-review.json', 'source': 'review/source-observations.json', 'geometry': 'geometry-reference.json', 'inventory': 'selected-inventory-records.json', 'continuity': 'geometry-duplicate-check.json'}
PUBLICATIONS = [{'source_key': 'manitoba_bedrock_geology_of2024_4', 'title': 'Bedrock geology of Manitoba, Open File OF2024-4', 'publisher': 'Manitoba Economic Development, Investment, Trade and Natural Resources, Manitoba Geological Survey', 'url': 'https://gov.mb.ca/iem/explore/files/geology_of_manitoba_map.pdf', 'original_acquired_at_utc': '2026-10-10T00:02:56.872607+00:00', 'acquisition_http_status': 200, 'original_acquisition_receipt_reviewed': True, 'retrieved_this_batch': False, 'reused_original': True, 'original_map_pixels_viewed': True, 'is_formal_naming_registry': False, 'publication_date': '2024', 'publication_date_precision': 'year', 'publication_date_verified': True, 'publication_date_note': 'The publication imprint explicitly says published by Manitoba Geological Survey, 2024. No month or day of publication is established; PDF modification and HTTP dates are not substituted.', 'review_reused_original_acquired_earlier_this_batch': False, 'review_reused_original_acquired_in_prior_batch': True, 'original_acquisition_batch': 'r34', 'directly_read_water_labels': ['Northern Indian Lake'], 'nearby_distinct_water_labels': ['Thorsteinson Lake', 'Wood Lake', 'Fidler Lake', 'Oldman River', 'Cobham River', 'Gunisao River', 'Reindeer Lake', 'McMillan Lake'], 'physical_pdf_pages': [1], 'role': 'Readable whole-footprint contexts support one generalized identity and one completed unnamed scope hold; regional-map resolution leaves the tiny third target material-pending.', 'authority_scope': 'Official provincial thematic cartographic usage supports these bounded associations. It is not a formal naming-registry decision and does not certify exact shorelines or name partitions.', 'registered_overlay_performed': True, 'own_observations': "Fresh original pixels and all 41 independently registered positions associate the central, northern and eastern basin and short western spur with the Northern Indian Lake label. White blue-shored water is distinct from peach, green and grey geological land. The southwestern edge ends at the connecting-water area before the long Thorsteinson southern basin, the northern tip stops below Oldman River, and the eastern tip does not follow the long continuation toward Fidler Lake. Coarse edges overshoot land, include islands and omit shoreline water. One generalized research identity is supported; exact lake/river and adjoining-lake name boundaries are unverified. Fresh original pixels and all 19 registered positions show the selected ring overlapping the western part of a compact unlabelled white lake amid purple and tan geological land. Much of the northern and western footprint lies over mapped land, while eastern and southern water is omitted. The southern connecting line leads toward the Cobham River context; Gunisao River is farther north. No direct target-water label is established and neither river name is assigned. Full readable context supports a completed unnamed identity/extent hold rather than source-material or access pending. Fresh source and rendered rings confirm five ordered positions but only three distinct vertices, including a consecutive duplicate and closure. All five are independently registered near the provincial border over orange geological pixels beside a narrow blue-shored white-water feature. The regional original cannot resolve the sliver's actual water association, even when magnified. Land-colored placement is not evidence that water is absent. Reindeer Lake and McMillan Lake are nearby labels, not supported target candidates. Complete geometry inspection is finished, but whole-feature source identity review remains material-pending; no source access denial occurred.", 'printed_scale': '1:1,000,000', 'cartographic_credit_observed': 'The digital topographic base credits the CanVec+ data model, Natural Resources Canada for hydrographic features, and the Manitoba Land Initiative, Manitoba Environment, Climate and Parks.', 'original_requested_at_utc': '2026-10-10T00:02:49.675330+00:00', 'printed_bibliographic_citation_year': '2024', 'printed_copyright_year': None, 'hydrographic_base_provider': 'CanVec+ data model, Natural Resources Canada (hydrographic features); Manitoba Land Initiative, Manitoba Environment, Climate and Parks'}]
REQUEST_COUNT = 0
ACQUISITION_COUNT = 0
REQUEST_ACCOUNTING = {'search_tool_calls': 0, 'search_queries': 0, 'explicit_web_open_requests': 0, 'original_body_requests': 0, 'new_original_bodies_acquired': 0, 'new_source_access_denials': 0, 'new_source_availability_failures': 0, 'stopped_resource_requests': 0, 'additional_source_acquisitions_planned': False}

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
 for d in [review,source,geometry,continuity]:assert d['batch']=='r45'
 for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
 assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
 stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
 assert review['prior_distinct_targets']==129 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==132 and review['duplicate_targets']==0
 assert review['current_batch_full_feature_correspondence_reviews_completed']==complete
 assert review['current_batch_source_limited_targets']==0 and review['current_batch_source_material_pending_targets']==len(pending)
 assert review['current_batch_follow_up_required_targets']==len(HOLD_INDEXES)+len(pending)
 assert review['current_batch_scope_hold_targets']==len(HOLD_INDEXES) and review['scalar_product_name_approvals']==0 and review['independent_source_comparison_completed']is True
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
  assert p['publication_date']==p['printed_bibliographic_citation_year']=='2024' and p['publication_date_precision']=='year' and p['publication_date_verified']is True
  assert p['printed_copyright_year']is None and p['hydrographic_base_provider']==PUBLICATIONS[0]['hydrographic_base_provider'] and p['physical_pdf_pages']==[1] and p['printed_scale']=='1:1,000,000'
 columns=[review['findings'],source['complete_feature_observations'],geometry['selected_features'],inventory['records']]
 for col in columns:assert [r['aw_id']for r in col]==IDS
 for i,(f,o,g,row)in enumerate(zip(*columns)):
  material=i in pending;hold=i in HOLD_INDEXES
  for x in [f,o,g,row]:assert x['source_id']==IDS[i].split(':')[1]
  assert f['baseline_logical_fid']==g['baseline_logical_fid']==row['logical_fid']==LOGICAL[i] and g['baseline_fid']==FIDS[i]
  for x in [f,o,row]:assert x['geometry_fids']==[FIDS[i]]
  assert f['fragment_count']==g['fragment_count']==row['geometry_count']==1
  for x in [f,o]:assert x['polygon_part_count']==x['ring_count']==1 and x['position_count_including_closure']==POSITIONS[i] and x['all_selected_parts_and_rings_considered']is True
  for k in ['source_geometry','baseline_rendered_geometry']:
   s=g[k];assert s['type']=='Polygon' and s['polygon_part_count']==1 and s['ring_counts_by_part']==[1] and s['coordinate_counts_by_part_and_ring']==[[POSITIONS[i]]] and s['total_coordinates_including_closure']==POSITIONS[i] and s['all_rings_closed']is True
  assert f['minimum_stage']==g['minimum_stage']==row['minimum_stage']==0
  assert row['bbox']==g['baseline_rendered_geometry']['bbox'] and f['category']==row['category']=='lake'
  assert f['source_keys']==o['source_keys']==FEATURE_SOURCES[i] and f['context_source_keys']==o['context_source_keys']==CONTEXT_SOURCES[i]
  assert f['full_feature_correspondence_review_completed']==(not material) and f['source_and_rendered_full_footprints_compared']is True and o['entire_selected_source_and_rendered_polygons_viewed']is True
  assert f['source_observation_id']==o['observation_id']==f['aw_id'] and o['independent_observation']==OBSERVATIONS[i]
  assert f['supported_name_scope'] and f['limits'] and f['follow_up_scope'] and f['geographic_disambiguation']==LOCATIONS[i]
  assert f['candidate_names']==f['directly_supported_name_forms']==NAMES[i] and f['candidate_name']==(NAMES[i][0]if NAMES[i]else None)
  assert f['source_material_pending']==material and f['source_access_limited']is False and f['complete_source_map_coverage_available']==(not material) and f['complete_geometry_inspection_performed']is True
  assert o['source_material_pending']==material and o['complete_source_map_coverage_available']==(not material) and o['full_feature_source_identity_review_completed']==(not material)
  assert f['research_category']==CATEGORIES[i] and f['review_status']==STATUSES[i] and f['candidate_name_role']==ROLES[i]
  assert f['follow_up_required']==(hold or material) and f['registered_overlay_performed']is True
  for x in [f,o]:assert x['geographic_map_coverage_available']is True and x['source_resolution_sufficient_for_whole_feature_identity']==(not material)
  c=f['name_confidence'];assert c['direct_label_reading']==DIRECT[i] and c['local_named_water_association']==LOCAL[i] and c['whole_selected_single_name']==WHOLE[i] and c['exact_named_extent']=='unverified' and c['basis']==OBSERVATIONS[i]
  assert f['selection_origin']=='new_inventory_investigation'
  for k in ['whole_feature_scalar_name','scalar_product_name','accepted_name','name_ko','korean_name','name_en','name_original']:assert f[k]is None
  for k in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified','exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:assert f[k]is False
  s=f['naming_scope_details'];assert s['selected_polygon_count']==1 and s['separately_labelled_water_names']==NAMES[i] and s['multiple_named_lakes_in_one_polygon']is False
  for k in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','supported_component_names_exhaustive']:assert s[k]==(not hold and not material)
  for k in ['whole_polygon_scalar_application_approved','precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed','component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed','entire_detailed_named_lake_representation_verified']:assert s[k]is False
  assert s['material_extent_limit']==EXTENT_LIMITS[i] and EXTENT_LIMITS[i]in f['supported_name_scope'] and EXTENT_LIMITS[i]in f['limits']
  assert s['unresolved_selected_parts']==[] and s['unresolved_named_extents']==UNRESOLVED[i]
  assert s['supported_component_associations']==ASSOCIATIONS[i]
 assert review['new_scope_hold_ids']==[IDS[i]for i in HOLD_INDEXES] and review['new_pending_access_ids']==[] and review['new_pending_material_ids']==[IDS[i]for i in sorted(pending)]
 assert review['preserved_pending_material_ids']==continuity['preserved_pending_material_ids']==['lakes_base:1159109285']
 assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
 assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==40
 previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==129
 preserved=[review[k]for k in ['preserved_scope_hold_ids','preserved_pending_access_ids','preserved_pending_material_ids']]
 assert all(set(preserved[i]).isdisjoint(preserved[j])for i in range(3)for j in range(i))
 assert set(sum(preserved,[]))<=set(previous) and set(previous).isdisjoint(IDS)
 assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
 assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r44/reconstruction-index.json'
 d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==129 and d['reconstructed_target_count_after']==132 and d['initial_eligible_target_count']==4065
 assert d['remaining_fresh_reconstruction_queue_before']==3936 and d['remaining_fresh_reconstruction_queue_after']==3933 and d['remaining_queue_types_after']=={'river_group':3412,'lake':521}
 return {'status':'passed','mode':'included_public_files_only','batch':'r45','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':65,'recorded_full_feature_correspondence_reviews_completed':complete,'new_scope_hold_ids':[IDS[i]for i in HOLD_INDEXES],'new_pending_access_ids':[],'new_pending_material_ids':[IDS[i]for i in sorted(pending)],'generalized_water_identities_supported':1,'bounded_partial_name_associations':0,'label_only_material_pending':0,'unresolved_resolution_material_pending':len(pending),'unnamed_identity_extent_holds':len(HOLD_INDEXES),'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':132,'recorded_target_types':{'river_group':43,'lake':89},'remaining_unrecorded_targets':3933,'cumulative_scope_hold_count':40+len(HOLD_INDEXES),'pending_access_count':2,'pending_material_count':1+len(pending),'pending_any_count':3+len(pending),'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Access, material and naming-scope states remain distinct. Exact extents and product naming remain unapproved.'}


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r45' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r45' and manifest['scope'] == 'included_public_files_only'
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
