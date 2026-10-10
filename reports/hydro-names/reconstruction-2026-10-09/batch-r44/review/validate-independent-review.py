#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted source judgments are not replayed."""
import hashlib,json,re,sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parent
IDS = ['lakes_base:1159112265', 'lakes_base:1159112279', 'lakes_base:1159112305']
NAMES = [['Gauer Lake'], ['Lake St. Martin'], ['Waterhen Lake']]
FEATURE_SOURCES = [['manitoba_bedrock_geology_of2024_4'], ['manitoba_bedrock_geology_of2024_4'], ['manitoba_bedrock_geology_of2024_4']]
CONTEXT_SOURCES = [[], [], []]
LOCATIONS = ['Northern Manitoba, Canada, at the Gauer Lake basin southwest of Thorsteinson Lake and east of Chapman Lake', 'Southern Manitoba, Canada, at Lake St. Martin south of the Dauphin River corridor', 'Southern Manitoba, Canada, at Waterhen Lake east of Lake Winnipegosis and southeast of Inland Lake']
EXTENT_LIMITS = ['The complete generalized ring follows the north arm, central basin, southwestern limb and southeastern lobe of Gauer Lake. The northeastern tip reaches the narrow connection but stops before the separately labelled Thorsteinson basin; the southwestern tip stops near the Gauer River approach. Coarse margins cross geological land, omit bays and narrow connecting waters, and do not preserve detailed island exclusions. Exact Gauer/Thorsteinson and river/lake transitions and the entire detailed named-lake extent remain unverified.', 'The complete generalized ring follows the main southern Lake St. Martin basin and its northeastern lobe. Its northern tip reaches the mouth area beside the Dauphin River corridor but does not include that long northward corridor. The ring cuts across geological land on the north and east, omits the southernmost lake tip and western bays, and simplifies islands and the narrow inter-lobe neck. Exact lake/river transitions and the entire detailed named-lake extent remain unverified.', 'The complete generalized ring follows the north-south Waterhen Lake basin and its two short southern lobes. The southern tips end above the long connecting reach; the separately labelled Lake Winnipegosis water, Inland Lake and Chitek Lake are surrounding context. The coarse western edge omits bays and shoreline water, eastern margins overshoot onto geological land, and narrow southern margins cut both water and land. Exact connecting-water name transitions and the entire detailed named-lake extent remain unverified.']
OBSERVATIONS = ['Fresh original pixels and all 51 registered positions associate the full generalized north/central/south basin with the printed Gauer Lake label. White water bounded in blue was distinguished from blue, cyan, peach, green and grey geological land. The northeastern endpoint lies near a narrow linkage before the separately labelled Thorsteinson basin; the southwest endpoint meets the Gauer River approach. Chapman, Torrance and Wernham lakes remain outside contexts. No distinct second named lake is established within the selected footprint, while substantial land overshoot and omitted shoreline detail prevent exact extent certification.', 'Fresh original pixels and all 68 registered positions associate the southern main basin, connecting neck and northeastern lobe with the blue Lake St. Martin water label. The black Lake St. Martin Structure label denotes geological context and was not used as another water name. White lake water is distinct from the large cyan, pink and grey geological units. The northern endpoint stops at the mouth area before the long Dauphin River corridor, with coarse land overshoot near the river approach. Western bays and the southern tip extend beyond the selected ring. One generalized lake identity is supported, not an exact named-water partition.', 'Fresh original pixels and all 44 registered positions associate the elongated main basin, north tip and short forked southern lobes with the Waterhen Lake label. White blue-shored water is distinct from tan and grey geological land. The southern endpoints do not extend along the long connecting line toward outside Lake Winnipegosis water. Inland Lake and Chitek Lake are separate northern/western contexts. The eastern side overshoots land, the western line omits water, and southern branches cut fine shorelines. One generalized identity is supported, without assigning adjacent lake names or certifying exact connecting-water boundaries.']
ASSOCIATIONS = [[{'name': 'Gauer Lake', 'scope': 'Complete selected generalized footprint with stated material extent limits'}], [{'name': 'Lake St. Martin', 'scope': 'Complete selected generalized footprint with stated material extent limits'}], [{'name': 'Waterhen Lake', 'scope': 'Complete selected generalized footprint with stated material extent limits'}]]
UNRESOLVED = [[], [], []]
FIDS = [15609, 15610, 15612]
LOGICAL = [4234, 4235, 4237]
POSITIONS = [51, 68, 44]
HOLD_INDEXES = []
PENDING_MATERIAL_INDEXES = []
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '925cbbd3b5dad10e782dd62078323f0da3eebc3a'
GEOMETRY_FILES = {'geometry-README.md', 'geometry-component-manifest.json', 'geometry-duplicate-check.json', 'validate-geometry-reference.py', 'selected-inventory-records.json', 'geometry-reference.json', 'test-geometry-reference.py', 'geometry-publication-rights.json', 'geometry-validation.json'}
REVIEW_FILES = {'independent-review.json', 'validate-independent-review.py', 'review-validation.json', 'source-observations.json', 'test-independent-review.py', 'README.md', 'review-manifest.json', 'public-input-pins.json'}
DOCUMENTS = {'review': 'review/independent-review.json', 'source': 'review/source-observations.json', 'geometry': 'geometry-reference.json', 'inventory': 'selected-inventory-records.json', 'continuity': 'geometry-duplicate-check.json'}
PUBLICATIONS = [{'source_key': 'manitoba_bedrock_geology_of2024_4', 'title': 'Bedrock geology of Manitoba, Open File OF2024-4', 'publisher': 'Manitoba Economic Development, Investment, Trade and Natural Resources, Manitoba Geological Survey', 'url': 'https://gov.mb.ca/iem/explore/files/geology_of_manitoba_map.pdf', 'original_acquired_at_utc': '2026-10-10T00:02:56.872607+00:00', 'acquisition_http_status': 200, 'original_acquisition_receipt_reviewed': True, 'retrieved_this_batch': False, 'reused_original': True, 'original_map_pixels_viewed': True, 'is_formal_naming_registry': False, 'publication_date': '2024', 'publication_date_precision': 'year', 'publication_date_verified': True, 'publication_date_note': 'The publication imprint explicitly says published by Manitoba Geological Survey, 2024. No month or day of publication is established; PDF modification and HTTP dates are not substituted.', 'review_reused_original_acquired_earlier_this_batch': False, 'review_reused_original_acquired_in_prior_batch': True, 'original_acquisition_batch': 'r34', 'directly_read_water_labels': ['Gauer Lake', 'Lake St. Martin', 'Waterhen Lake'], 'nearby_distinct_water_labels': ['Thorsteinson Lake', 'Chapman Lake', 'Torrance Lake', 'Wernham Lake', 'Gauer River', 'Dauphin River', 'Lake Winnipegosis', 'Inland Lake', 'Chitek Lake'], 'physical_pdf_pages': [1], 'role': 'Complete readable footprints and connecting-water contexts support three generalized research lake identities with material extent limits.', 'authority_scope': 'Official provincial thematic cartographic usage supports these bounded associations. It is not a formal naming-registry decision and does not certify exact shorelines or name partitions.', 'registered_overlay_performed': True, 'own_observations': 'Fresh original pixels and all 51 registered positions associate the full generalized north/central/south basin with the printed Gauer Lake label. White water bounded in blue was distinguished from blue, cyan, peach, green and grey geological land. The northeastern endpoint lies near a narrow linkage before the separately labelled Thorsteinson basin; the southwest endpoint meets the Gauer River approach. Chapman, Torrance and Wernham lakes remain outside contexts. No distinct second named lake is established within the selected footprint, while substantial land overshoot and omitted shoreline detail prevent exact extent certification. Fresh original pixels and all 68 registered positions associate the southern main basin, connecting neck and northeastern lobe with the blue Lake St. Martin water label. The black Lake St. Martin Structure label denotes geological context and was not used as another water name. White lake water is distinct from the large cyan, pink and grey geological units. The northern endpoint stops at the mouth area before the long Dauphin River corridor, with coarse land overshoot near the river approach. Western bays and the southern tip extend beyond the selected ring. One generalized lake identity is supported, not an exact named-water partition. Fresh original pixels and all 44 registered positions associate the elongated main basin, north tip and short forked southern lobes with the Waterhen Lake label. White blue-shored water is distinct from tan and grey geological land. The southern endpoints do not extend along the long connecting line toward outside Lake Winnipegosis water. Inland Lake and Chitek Lake are separate northern/western contexts. The eastern side overshoots land, the western line omits water, and southern branches cut fine shorelines. One generalized identity is supported, without assigning adjacent lake names or certifying exact connecting-water boundaries.', 'printed_scale': '1:1,000,000', 'cartographic_credit_observed': 'The digital topographic base credits the CanVec+ data model, Natural Resources Canada for hydrographic features, and the Manitoba Land Initiative, Manitoba Environment, Climate and Parks.', 'original_requested_at_utc': '2026-10-10T00:02:49.675330+00:00', 'printed_bibliographic_citation_year': '2024', 'printed_copyright_year': None, 'hydrographic_base_provider': 'CanVec+ data model, Natural Resources Canada (hydrographic features); Manitoba Land Initiative, Manitoba Environment, Climate and Parks'}]
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
 for d in [review,source,geometry,continuity]:assert d['batch']=='r44'
 for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
 assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
 stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
 assert review['prior_distinct_targets']==126 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==129 and review['duplicate_targets']==0
 assert review['current_batch_full_feature_correspondence_reviews_completed']==complete
 for k in ['current_batch_source_limited_targets','current_batch_source_material_pending_targets']:assert review[k]==0
 assert review['current_batch_follow_up_required_targets']==len(HOLD_INDEXES)
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
  assert f['minimum_stage']==g['minimum_stage']==row['minimum_stage']==2
  assert row['bbox']==g['baseline_rendered_geometry']['bbox'] and f['category']==row['category']=='lake'
  assert f['source_keys']==o['source_keys']==FEATURE_SOURCES[i] and f['context_source_keys']==o['context_source_keys']==CONTEXT_SOURCES[i]
  assert f['full_feature_correspondence_review_completed']==(not material) and f['source_and_rendered_full_footprints_compared']is True and o['entire_selected_source_and_rendered_polygons_viewed']is True
  assert f['source_observation_id']==o['observation_id']==f['aw_id'] and o['independent_observation']==OBSERVATIONS[i]
  assert f['supported_name_scope'] and f['limits'] and f['follow_up_scope'] and f['geographic_disambiguation']==LOCATIONS[i]
  assert f['candidate_names']==f['directly_supported_name_forms']==NAMES[i] and f['candidate_name']==(None if hold else NAMES[i][0])
  assert f['source_material_pending']==material and f['source_access_limited']is False and f['complete_source_map_coverage_available']==(not material) and f['complete_geometry_inspection_performed']is True
  assert o['source_material_pending']==material and o['complete_source_map_coverage_available']==(not material) and o['full_feature_source_identity_review_completed']==(not material)
  assert f['research_category']==('candidate_waterbody_identity_extent_hold'if hold else'supported_generalized_water_identity') and f['review_status']==('partial_named_water_identity_extent_scalar_name_hold'if hold else'supported_generalized_identity_with_material_extent_limits') and f['candidate_name_role']==('partial_name_association_not_whole_feature_alias'if hold else'generalized_research_identity_not_product_scalar')
  assert f['follow_up_required']==hold and f['registered_overlay_performed']is True
  c=f['name_confidence'];assert c['direct_label_reading']=='high' and c['local_named_water_association']==('high_for_bounded_component'if hold else'high') and c['whole_selected_single_name']==('unresolved_identity_and_extent'if hold else'supported_generalized_identity') and c['exact_named_extent']=='unverified' and c['basis']==OBSERVATIONS[i]
  assert f['selection_origin']=='new_inventory_investigation'
  for k in ['whole_feature_scalar_name','scalar_product_name','accepted_name','name_ko','korean_name','name_en','name_original']:assert f[k]is None
  for k in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified','exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:assert f[k]is False
  s=f['naming_scope_details'];assert s['selected_polygon_count']==1 and s['separately_labelled_water_names']==NAMES[i] and s['multiple_named_lakes_in_one_polygon']is False
  for k in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','supported_component_names_exhaustive']:assert s[k]==(not hold)
  for k in ['whole_polygon_scalar_application_approved','precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed','component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed','entire_detailed_named_lake_representation_verified']:assert s[k]is False
  assert s['material_extent_limit']==EXTENT_LIMITS[i] and EXTENT_LIMITS[i]in f['supported_name_scope'] and EXTENT_LIMITS[i]in f['limits']
  assert s['unresolved_selected_parts']==[] and s['unresolved_named_extents']==UNRESOLVED[i]
  assert s['supported_component_associations']==ASSOCIATIONS[i]
 assert review['new_scope_hold_ids']==[IDS[i]for i in HOLD_INDEXES] and review['new_pending_access_ids']==[] and review['new_pending_material_ids']==[IDS[i]for i in sorted(pending)]
 assert review['preserved_pending_material_ids']==continuity['preserved_pending_material_ids']==['lakes_base:1159109285']
 assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
 assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==40
 previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==126
 preserved=[review[k]for k in ['preserved_scope_hold_ids','preserved_pending_access_ids','preserved_pending_material_ids']]
 assert all(set(preserved[i]).isdisjoint(preserved[j])for i in range(3)for j in range(i))
 assert set(sum(preserved,[]))<=set(previous) and set(previous).isdisjoint(IDS)
 assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
 assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r43/reconstruction-index.json'
 d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==126 and d['reconstructed_target_count_after']==129 and d['initial_eligible_target_count']==4065
 assert d['remaining_fresh_reconstruction_queue_before']==3939 and d['remaining_fresh_reconstruction_queue_after']==3936 and d['remaining_queue_types_after']=={'river_group':3412,'lake':524}
 return {'status':'passed','mode':'included_public_files_only','batch':'r44','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':163,'recorded_full_feature_correspondence_reviews_completed':complete,'new_scope_hold_ids':[IDS[i]for i in HOLD_INDEXES],'new_pending_access_ids':[],'new_pending_material_ids':[IDS[i]for i in sorted(pending)],'generalized_water_identities_supported':3,'bounded_partial_name_associations':0,'label_only_material_pending':len(pending),'unnamed_identity_extent_holds':0,'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':129,'recorded_target_types':{'river_group':43,'lake':86},'remaining_unrecorded_targets':3936,'cumulative_scope_hold_count':40,'pending_access_count':2,'pending_material_count':1+len(pending),'pending_any_count':3+len(pending),'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Access, material and naming-scope states remain distinct. Exact extents and product naming remain unapproved.'}


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r44' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r44' and manifest['scope'] == 'included_public_files_only'
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
