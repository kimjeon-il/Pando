#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted source judgments are not replayed."""
import hashlib,json,re,sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parent
IDS = ['lakes_base:1159112329', 'lakes_base:1159108445', 'lakes_base:1159112319']
NAMES = [['Kesagami Lake'], ['Missinaibi Lake'], ['Night Hawk Lake']]
FEATURE_SOURCES = [['ogs_index_bedrock_east_central_2021'], ['ogs_index_bedrock_east_central_2021'], ['ogs_index_bedrock_east_central_2021']]
CONTEXT_SOURCES = [[], [], []]
LOCATIONS = ['Northeastern Ontario, Canada, at the Kesagami Lake basin and its Opimiskau and Newnham bays', 'Northeastern Ontario, Canada, at the long branching Missinaibi Lake basin', 'Northeastern Ontario, Canada, at Night Hawk Lake east of Timmins and South Porcupine']
EXTENT_LIMITS = ['The complete selected generalized ring follows the broad northern and central Kesagami Lake basin, the western lobe at Opimiskau Bay and the long southern arm at Newnham Bay. These bay labels describe subordinate parts of the same mapped lake, not separate selected lakes. Piyagoskogau Lake and Natogami Lake are outside this selected basin. Coarse lines overshoot white land, cut across shore indentations and omit detailed bay water; northern and southern lake/channel transitions are not precisely established. The entire detailed named-lake extent is not certified.', 'The complete forked ring follows the connected long southwest-northeast arms of Missinaibi Lake and their central connection. The split lake label is partly over white land between the arms, so label position alone is not used as identity. Generalized margins cross land and omit narrow bays, side branches and terminal water. The northeastern tip stops before the eastward connecting river, and the western end stops before farther western waters. Exact lake/river transitions, detailed shores and the entire named-lake extent remain unverified.', 'The complete generalized ring follows the main Night Hawk Lake basin, its narrow western southern arm and a coarse northern connecting-water extension. The independently registered Timmins inset clarifies the main basin and arm despite index-map overprint. Pale cyan marks water; the large white region southeast of the arm is land, not an omitted lake lobe. The northern tip, western margin and parts of the southern arm overshoot mapped land, while small bays and terminal water are omitted. Exact northern lake/channel division, southern connection, overprinted shores and the entire detailed named-lake extent remain unverified.']
OBSERVATIONS = ['Original main-sheet pixels and all 56 independently registered positions show pale-cyan water bounded by blue shores. Kesagami Lake labels the main basin; Opimiskau Bay is the western lobe and Newnham Bay the long southern arm. The ring follows this whole generalized topology and remains outside separately labelled Piyagoskogau Lake and Natogami Lake. Straight edges include some white land and exclude detailed bay water. One generalized research identity is supported with shoreline and connector limits.', 'Original main-sheet pixels and all 43 independently registered positions show the connected multiarm Missinaibi Lake water. Missinaibi and Lake are printed across white land between pale-cyan arms. The complete ring follows both long arms and their junction while crossing land and omitting smaller branches. Red map-index lines and grey township borders are contextual overlays. Wider context separates the selected lake from connecting rivers and distant labelled lakes. One generalized research identity is supported; precise shore and connector limits are unverified.', 'Original main-sheet pixels, the independently registered Timmins inset and all 35 ordered ring positions associate the broad main basin and narrow western southern arm with the printed Night Hawk Lake name. Original RGB samples distinguish pale-cyan water from white land; the extensive southeast white area is land. The coarse northern extension crosses mapped land beside the northward water connection, and western/southern edges include land and omit small shore features. Main-sheet red/pink index overprint is clarified by the inset from the same original. One generalized identity is supported with material shoreline and channel-transition limits.']
ASSOCIATIONS = [[{'name': 'Kesagami Lake', 'scope': 'Complete selected generalized footprint with stated material extent limits'}], [{'name': 'Missinaibi Lake', 'scope': 'Complete selected generalized footprint with stated material extent limits'}], [{'name': 'Night Hawk Lake', 'scope': 'Complete selected generalized footprint with stated material extent limits'}]]
UNRESOLVED = [[], [], []]
FIDS = [15614, 15338, 15613]
LOGICAL = [4239, 3963, 4238]
POSITIONS = [56, 43, 35]
STAGES = [2, 0, 2]
HOLD_INDEXES = []
PENDING_MATERIAL_INDEXES = []
CATEGORIES = ['supported_generalized_water_identity', 'supported_generalized_water_identity', 'supported_generalized_water_identity']
STATUSES = ['supported_generalized_identity_with_material_extent_limits', 'supported_generalized_identity_with_material_extent_limits', 'supported_generalized_identity_with_material_extent_limits']
ROLES = ['generalized_research_identity_not_product_scalar', 'generalized_research_identity_not_product_scalar', 'generalized_research_identity_not_product_scalar']
DIRECT = ['high', 'high', 'high']
LOCAL = ['high', 'high', 'high']
WHOLE = ['supported_generalized_identity', 'supported_generalized_identity', 'supported_generalized_identity']
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '17025b8aedaf0766efe62bd35e8d95e52bb15e06'
GEOMETRY_FILES = {'geometry-README.md', 'test-geometry-reference.py', 'geometry-validation.json', 'geometry-duplicate-check.json', 'geometry-component-manifest.json', 'validate-geometry-reference.py', 'selected-inventory-records.json', 'geometry-publication-rights.json', 'geometry-reference.json'}
REVIEW_FILES = {'independent-review.json', 'README.md', 'source-observations.json', 'validate-independent-review.py', 'public-input-pins.json', 'review-manifest.json', 'test-independent-review.py', 'review-validation.json'}
DOCUMENTS = {'review': 'review/independent-review.json', 'source': 'review/source-observations.json', 'geometry': 'geometry-reference.json', 'inventory': 'selected-inventory-records.json', 'continuity': 'geometry-duplicate-check.json'}
PUBLICATIONS = [{'source_key': 'ogs_index_bedrock_east_central_2021', 'title': 'Index to Maps, Bedrock Geology, 1991–2020, East-Central Sheet', 'publisher': 'Ontario Geological Survey, Ontario Ministry of Energy, Northern Development and Mines', 'url': 'https://www.geologyontario.mndm.gov.on.ca/mines/ogs/indexes/pdfs/INDEX-Bedrock-EastCentral.pdf', 'original_acquired_at_utc': '2026-10-10T03:32:38.746493+00:00', 'original_requested_at_utc': '2026-10-10T03:32:31.805351+00:00', 'acquisition_http_status': 200, 'original_acquisition_receipt_reviewed': True, 'retrieved_this_batch': True, 'reused_original': False, 'original_map_pixels_viewed': True, 'is_formal_naming_registry': False, 'publication_date': '2021', 'publication_date_precision': 'year', 'publication_date_verified': True, 'publication_date_note': 'The printed suggested citation and copyright establish 2021, with year precision. The title period 1991–2020 describes the indexed mapping, not the publication date. HTTP and PDF metadata dates are not substituted.', 'review_reused_original_acquired_earlier_this_batch': True, 'review_reused_original_acquired_in_prior_batch': False, 'original_acquisition_batch': 'r46', 'directly_read_water_labels': ['Kesagami Lake', 'Missinaibi Lake', 'Night Hawk Lake'], 'nearby_distinct_water_labels': ['Opimiskau Bay', 'Newnham Bay', 'Piyagoskogau Lake', 'Natogami Lake'], 'physical_pdf_pages': [1], 'role': 'Main-sheet complete-footprint and wider contexts support three generalized lake identities; the same original Timmins inset clarifies the third basin and connecting water.', 'authority_scope': 'Official provincial thematic cartographic usage, not a formal naming-registry decision or exact shoreline/name-partition certification.', 'registered_overlay_performed': True, 'own_observations': 'Original main-sheet pixels and all 56 independently registered positions show pale-cyan water bounded by blue shores. Kesagami Lake labels the main basin; Opimiskau Bay is the western lobe and Newnham Bay the long southern arm. The ring follows this whole generalized topology and remains outside separately labelled Piyagoskogau Lake and Natogami Lake. Straight edges include some white land and exclude detailed bay water. One generalized research identity is supported with shoreline and connector limits. Original main-sheet pixels and all 43 independently registered positions show the connected multiarm Missinaibi Lake water. Missinaibi and Lake are printed across white land between pale-cyan arms. The complete ring follows both long arms and their junction while crossing land and omitting smaller branches. Red map-index lines and grey township borders are contextual overlays. Wider context separates the selected lake from connecting rivers and distant labelled lakes. One generalized research identity is supported; precise shore and connector limits are unverified. Original main-sheet pixels, the independently registered Timmins inset and all 35 ordered ring positions associate the broad main basin and narrow western southern arm with the printed Night Hawk Lake name. Original RGB samples distinguish pale-cyan water from white land; the extensive southeast white area is land. The coarse northern extension crosses mapped land beside the northward water connection, and western/southern edges include land and omit small shore features. Main-sheet red/pink index overprint is clarified by the inset from the same original. One generalized identity is supported with material shoreline and channel-transition limits.', 'printed_scale': '1:1,000,000', 'cartographic_credit_observed': 'Index-map compilation and editing are credited to OGS Publication Services Unit; map-outline compilation and cartographic production to J. Rose. The credit block warns of base-map and survey-index discrepancies.', 'printed_bibliographic_citation_year': '2021', 'printed_copyright_year': '2021', 'hydrographic_base_provider': None, 'hydrographic_base_provider_note': 'No separately named hydrographic dataset provider is identified in the inspected printed sources-and-credits block.'}]
REQUEST_COUNT = 2
ACQUISITION_COUNT = 1
REQUEST_ACCOUNTING = {'search_tool_calls': 1, 'search_queries': 1, 'explicit_web_open_requests': 0, 'original_body_requests': 1, 'new_original_bodies_acquired': 1, 'new_source_access_denials': 0, 'new_source_availability_failures': 0, 'stopped_resource_requests': 0, 'additional_source_acquisitions_planned': False}

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
 for d in [review,source,geometry,continuity]:assert d['batch']=='r46'
 for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
 assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
 stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
 assert review['prior_distinct_targets']==132 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==135 and review['duplicate_targets']==0
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
  assert p['publication_date']==p['printed_bibliographic_citation_year']==PUBLICATIONS[0]['publication_date'] and p['publication_date_precision']=='year' and p['publication_date_verified']is True
  assert p['printed_copyright_year']==PUBLICATIONS[0]['printed_copyright_year'] and p['hydrographic_base_provider']==PUBLICATIONS[0]['hydrographic_base_provider'] and p['physical_pdf_pages']==[1] and p['printed_scale']==PUBLICATIONS[0]['printed_scale']
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
  assert f['minimum_stage']==g['minimum_stage']==row['minimum_stage']==STAGES[i]
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
 assert review['preserved_pending_material_ids']==continuity['preserved_pending_material_ids']==['lakes_base:1159109285','lakes_base:1159107185']
 assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
 assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==41
 previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==132
 preserved=[review[k]for k in ['preserved_scope_hold_ids','preserved_pending_access_ids','preserved_pending_material_ids']]
 assert all(set(preserved[i]).isdisjoint(preserved[j])for i in range(3)for j in range(i))
 assert set(sum(preserved,[]))<=set(previous) and set(previous).isdisjoint(IDS)
 assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
 assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r45/reconstruction-index.json'
 d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==132 and d['reconstructed_target_count_after']==135 and d['initial_eligible_target_count']==4065
 assert d['remaining_fresh_reconstruction_queue_before']==3933 and d['remaining_fresh_reconstruction_queue_after']==3930 and d['remaining_queue_types_after']=={'river_group':3412,'lake':518}
 return {'status':'passed','mode':'included_public_files_only','batch':'r46','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':134,'recorded_full_feature_correspondence_reviews_completed':complete,'new_scope_hold_ids':[IDS[i]for i in HOLD_INDEXES],'new_pending_access_ids':[],'new_pending_material_ids':[IDS[i]for i in sorted(pending)],'generalized_water_identities_supported':3-len(HOLD_INDEXES)-len(pending),'bounded_partial_name_associations':0,'label_only_material_pending':0,'unresolved_resolution_material_pending':len(pending),'unnamed_identity_extent_holds':len(HOLD_INDEXES),'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':135,'recorded_target_types':{'river_group':43,'lake':92},'remaining_unrecorded_targets':3930,'cumulative_scope_hold_count':41+len(HOLD_INDEXES),'pending_access_count':2,'pending_material_count':2+len(pending),'pending_any_count':4+len(pending),'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Access, material and naming-scope states remain distinct. Exact extents and product naming remain unapproved.'}


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r46' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r46' and manifest['scope'] == 'included_public_files_only'
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
