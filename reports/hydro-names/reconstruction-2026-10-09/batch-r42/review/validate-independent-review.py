#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted source judgments are not replayed."""
import hashlib,json,re,sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parent
IDS = ['lakes_base:1159110041', 'lakes_base:1159108693', 'lakes_base:1159108673']
NAMES = [[], ['Cat Lake', 'Kapikik Lake'], ['Zionz Lake', 'Fawcett Lake', 'Gull Lake']]
FEATURE_SOURCES = [[], ['ogs_index_bedrock_west_central_2021'], ['ogs_index_bedrock_west_central_2021']]
CONTEXT_SOURCES = [['ogs_index_bedrock_northern_2021'], [], []]
LOCATIONS = ['Northern Ontario, Canada, at the small southwestern water widening southwest of the labelled Muskrat Dam Lake body', 'Northern Ontario, Canada, in the connected Cat Lake and Kapikik Lake waters south of Whitestone Lake', 'Northern Ontario, Canada, in Zionz Lake, Fawcett Lake and selected western Gull-area waters north of the Cat River continuation']
EXTENT_LIMITS = ['No name is established for the complete selected southwestern widening. Its eight-position outline covers only part of mapped water, crosses land at its northern margin and northeastern tip, and omits southern water and a narrow northeastern continuation. Muskrat Dam Lake is labelled on larger water farther northeast; a connection and nearby split Severn and River text do not establish that lake name or a whole-selected lake identity.', 'The complete generalized ring combines selected Cat Lake water, including the long eastern branch, with selected Kapikik Lake water in its southern lobe. Narrow connected reaches are absorbed, the coarse eastern and western margins cross mapped land between bays, the southeastern termination extends onto land, and fine shores and islands are omitted. Exact boundaries between the two labelled waters and the full detailed extent of either lake are unverified.', 'The complete generalized ring spans selected Zionz Lake water in the northern lobe, Fawcett Lake water in the east-central lobe, and only part of the western/southern Gull Lake area. The western triangular tips and broad straight margins cross mapped land; connecting reaches are absorbed and southeastern water is omitted. This is not the whole detailed extent of any of the three named lakes. Exact partitions, connecting-water names and exhaustiveness are unverified.']
OBSERVATIONS = ['Original Northern Sheet pixels show the complete eight-position outline on the southwestern widening of connected pale-cyan water. Severn and River text is split around this area, while Muskrat Dam Lake is printed over the northeastern larger water beyond a narrow continuation. Windigo labels a tributary farther south. No selected-water lake label is established; none of these contextual names is assigned to the whole ring. Readable hydrography supports an identity/extent scope hold, not material or access pending.', 'Original West-Central pixels and all 53 registered positions show the broad Cat Lake body and eastern branch connected through a narrower southern stretch to the selected lobe carrying Kapikik Lake. The southern named association is substantial. Whitestone Lake farther north and Zionz Lake farther south are contextual. Cat Lake and Kapikik Lake are separate printed water names, not aliases; a single scalar name would conceal the compound scope. Coarse edges cross mapped land and omit fine water features.', 'Original West-Central pixels and all 52 registered positions show Zionz Lake in the northern lobe and Fawcett Lake beside the east-central lobe. Western and southern selected portions overlap only part of water associated with Gull Lake; no whole-Gull inclusion is asserted. Narrow reaches connect these areas, and coarse westward tips overshoot mapped water onto land. Kapikik Lake to the north and Cat River/Bamaji Lake farther southeast are contextual. The three printed lake names are component associations, not aliases or exact geometric partitions.']
ASSOCIATIONS = [[], [{'name': 'Cat Lake', 'scope': 'Northern and east-reaching selected portions; exact detailed extent and southern transition unverified'}, {'name': 'Kapikik Lake', 'scope': 'Southern selected lobe; exact detailed extent and northern transition unverified'}], [{'name': 'Zionz Lake', 'scope': 'Northern selected lobe; exact detailed extent unverified'}, {'name': 'Fawcett Lake', 'scope': 'East-central selected lobe; exact detailed extent unverified'}, {'name': 'Gull Lake', 'scope': 'Partial western/southern selected-water association only; entire named lake not included or verified'}]]
UNRESOLVED = [['Whole selected southwestern widening: selected-water name and exact relation to adjacent named waters are unverified'], ['Exact Cat Lake/Kapikik Lake partition and connecting-water extents are unverified'], ['Exact Zionz/Fawcett/Gull partitions, partial Gull extent and connecting-water identities are unverified']]
FIDS = [15461, 15356, 15355]
LOGICAL = [4086, 3981, 3980]
POSITIONS = [8, 53, 52]
PENDING_MATERIAL_INDEXES = []
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = 'aa26acec7112c1e57e049865c4466c6dbded9335'
GEOMETRY_FILES = {'geometry-component-manifest.json', 'validate-geometry-reference.py', 'geometry-validation.json', 'geometry-publication-rights.json', 'geometry-README.md', 'selected-inventory-records.json', 'geometry-duplicate-check.json', 'geometry-reference.json', 'test-geometry-reference.py'}
REVIEW_FILES = {'source-observations.json', 'public-input-pins.json', 'validate-independent-review.py', 'test-independent-review.py', 'review-validation.json', 'independent-review.json', 'README.md', 'review-manifest.json'}
DOCUMENTS = {'review': 'review/independent-review.json', 'source': 'review/source-observations.json', 'geometry': 'geometry-reference.json', 'inventory': 'selected-inventory-records.json', 'continuity': 'geometry-duplicate-check.json'}
PUBLICATIONS = [{'source_key': 'ogs_index_bedrock_northern_2021', 'title': 'Index to Maps, Bedrock Geology, 1991–2020, Northern Sheet', 'publisher': 'Ontario Geological Survey', 'url': 'https://www.geologyontario.mndm.gov.on.ca/mines/ogs/indexes/pdfs/INDEX-Bedrock-Northern.pdf', 'original_acquired_at_utc': '2026-10-10T01:44:15.182007+00:00', 'acquisition_http_status': 200, 'original_acquisition_receipt_reviewed': True, 'retrieved_this_batch': False, 'reused_original': True, 'original_map_pixels_viewed': True, 'is_formal_naming_registry': False, 'publication_date': '2021', 'publication_date_precision': 'year', 'publication_date_verified': True, 'publication_date_note': 'The original suggested citation identifies Ontario Geological Survey 2021. Copyright year 2021 is recorded separately. The title interval 1991–2020 describes indexed map coverage; no publication month or day is established.', 'review_reused_original_acquired_earlier_this_batch': False, 'review_reused_original_acquired_in_prior_batch': True, 'original_acquisition_batch': 'r40', 'directly_read_water_labels': [], 'nearby_distinct_water_labels': ['Muskrat Dam Lake', 'Severn', 'River', 'Windigo'], 'physical_pdf_pages': [1], 'role': 'Readable selected-water coverage and surrounding names establish an unnamed identity/extent scope hold; no selected lake name assigned.', 'authority_scope': 'Official provincial thematic cartographic usage supports only these bounded scope observations. It is not a formal naming-registry decision and does not certify exact shoreline or name partitions.', 'registered_overlay_performed': True, 'own_observations': 'Original Northern Sheet pixels show the complete eight-position outline on the southwestern widening of connected pale-cyan water. Severn and River text is split around this area, while Muskrat Dam Lake is printed over the northeastern larger water beyond a narrow continuation. Windigo labels a tributary farther south. No selected-water lake label is established; none of these contextual names is assigned to the whole ring. Readable hydrography supports an identity/extent scope hold, not material or access pending.', 'printed_scale': '1:1,000,000', 'cartographic_credit_observed': 'Publication Services Unit, Ontario Geological Survey compiled and edited the index; J. Rose is credited for map outlines and cartographic production. The credits caution that coverage outlines and the topographic base may differ and that editorial review was limited.', 'printed_copyright_year': '2021', 'printed_bibliographic_citation_year': '2021', 'hydrographic_base_provider': None, 'original_requested_at_utc': '2026-10-10T01:44:07.664713+00:00'}, {'source_key': 'ogs_index_bedrock_west_central_2021', 'title': 'Index to Maps, Bedrock Geology, 1991–2020, West-Central Sheet', 'publisher': 'Ontario Geological Survey', 'url': 'https://www.geologyontario.mndm.gov.on.ca/mines/ogs/indexes/pdfs/INDEX-Bedrock-WestCentral.pdf', 'original_acquired_at_utc': '2026-10-10T02:07:35.288175+00:00', 'acquisition_http_status': 200, 'original_acquisition_receipt_reviewed': True, 'retrieved_this_batch': False, 'reused_original': True, 'original_map_pixels_viewed': True, 'is_formal_naming_registry': False, 'publication_date': '2021', 'publication_date_precision': 'year', 'publication_date_verified': True, 'publication_date_note': 'The original suggested citation identifies Ontario Geological Survey 2021. Copyright year 2021 is recorded separately. The title interval 1991–2020 describes indexed map coverage; no publication month or day is established.', 'review_reused_original_acquired_earlier_this_batch': False, 'review_reused_original_acquired_in_prior_batch': True, 'original_acquisition_batch': 'r41', 'directly_read_water_labels': ['Cat Lake', 'Kapikik Lake', 'Zionz Lake', 'Fawcett Lake', 'Gull Lake'], 'nearby_distinct_water_labels': ['Whitestone Lake', 'Gitche Lake', 'Cat River', 'Bamaji Lake'], 'physical_pdf_pages': [1], 'role': 'Readable complete selected footprints establish compound scope holds for Cat/Kapikik and Zionz/Fawcett/partial Gull associations.', 'authority_scope': 'Official provincial thematic cartographic usage supports only these bounded scope observations. It is not a formal naming-registry decision and does not certify exact shoreline or name partitions.', 'registered_overlay_performed': True, 'own_observations': 'Original West-Central pixels and all 53 registered positions show the broad Cat Lake body and eastern branch connected through a narrower southern stretch to the selected lobe carrying Kapikik Lake. The southern named association is substantial. Whitestone Lake farther north and Zionz Lake farther south are contextual. Cat Lake and Kapikik Lake are separate printed water names, not aliases; a single scalar name would conceal the compound scope. Coarse edges cross mapped land and omit fine water features. Original West-Central pixels and all 52 registered positions show Zionz Lake in the northern lobe and Fawcett Lake beside the east-central lobe. Western and southern selected portions overlap only part of water associated with Gull Lake; no whole-Gull inclusion is asserted. Narrow reaches connect these areas, and coarse westward tips overshoot mapped water onto land. Kapikik Lake to the north and Cat River/Bamaji Lake farther southeast are contextual. The three printed lake names are component associations, not aliases or exact geometric partitions.', 'printed_scale': '1:1,000,000', 'cartographic_credit_observed': 'Publication Services Unit, Ontario Geological Survey compiled and edited the index; J. Rose is credited for map outlines and cartographic production. The credits caution that coverage outlines and the topographic base may differ and that editorial review was limited.', 'printed_copyright_year': '2021', 'printed_bibliographic_citation_year': '2021', 'hydrographic_base_provider': None, 'original_requested_at_utc': '2026-10-10T02:07:26.442841+00:00'}]
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
 for d in [review,source,geometry,continuity]:assert d['batch']=='r42'
 for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
 assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
 stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
 assert review['prior_distinct_targets']==120 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==123 and review['duplicate_targets']==0
 assert review['current_batch_full_feature_correspondence_reviews_completed']==complete
 for k in ['current_batch_source_limited_targets','current_batch_source_material_pending_targets']:assert review[k]==0
 assert review['current_batch_follow_up_required_targets']==3
 assert review['current_batch_scope_hold_targets']==3 and review['scalar_product_name_approvals']==0 and review['independent_source_comparison_completed']is True
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
  assert f['candidate_names']==f['directly_supported_name_forms']==NAMES[i] and f['candidate_name']is None
  assert f['source_material_pending']==material and f['source_access_limited']is False and f['complete_source_map_coverage_available']==(not material) and f['complete_geometry_inspection_performed']is True
  assert o['source_material_pending']==material and o['complete_source_map_coverage_available']==(not material) and o['full_feature_source_identity_review_completed']==(not material)
  assert f['research_category']==('candidate_waterbody_identity_extent_hold'if i==0 else'compound_feature_name_scope_hold') and f['review_status']==('unresolved_water_identity_and_extent_scalar_name_hold'if i==0 else'multiple_named_waters_scalar_name_hold') and f['candidate_name_role']==('no_named_candidate_established_for_selected_water'if i==0 else'component_name_associations_not_whole_feature_aliases')
  assert f['follow_up_required']is True and f['registered_overlay_performed']is True
  c=f['name_confidence'];assert c['direct_label_reading']==('no_selected_water_label_established'if i==0 else'high') and c['local_named_water_association']==('unresolved'if i==0 else'high_for_bounded_components') and c['whole_selected_single_name']==('unresolved_identity_and_extent'if i==0 else'unsupported_compound_feature') and c['exact_named_extent']=='unverified' and c['basis']==OBSERVATIONS[i]
  assert f['selection_origin']=='new_inventory_investigation'
  for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','korean_name','name_en','name_original']:assert f[k]is None
  for k in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified','exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:assert f[k]is False
  s=f['naming_scope_details'];assert s['selected_polygon_count']==1 and s['separately_labelled_water_names']==NAMES[i] and s['multiple_named_lakes_in_one_polygon']==(i>0)
  for k in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','supported_component_names_exhaustive']:assert s[k]is False
  for k in ['whole_polygon_scalar_application_approved','precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed','component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed','entire_detailed_named_lake_representation_verified']:assert s[k]is False
  assert s['material_extent_limit']==EXTENT_LIMITS[i] and EXTENT_LIMITS[i]in f['supported_name_scope'] and EXTENT_LIMITS[i]in f['limits']
  assert s['unresolved_selected_parts']==[] and s['unresolved_named_extents']==UNRESOLVED[i]
  assert s['supported_component_associations']==ASSOCIATIONS[i]
 assert review['new_scope_hold_ids']==IDS and review['new_pending_access_ids']==[] and review['new_pending_material_ids']==[IDS[i]for i in sorted(pending)]
 assert review['preserved_pending_material_ids']==continuity['preserved_pending_material_ids']==['lakes_base:1159109285']
 assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
 assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==36
 previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==120
 preserved=[review[k]for k in ['preserved_scope_hold_ids','preserved_pending_access_ids','preserved_pending_material_ids']]
 assert all(set(preserved[i]).isdisjoint(preserved[j])for i in range(3)for j in range(i))
 assert set(sum(preserved,[]))<=set(previous) and set(previous).isdisjoint(IDS)
 assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
 assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r41/reconstruction-index.json'
 d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==120 and d['reconstructed_target_count_after']==123 and d['initial_eligible_target_count']==4065
 assert d['remaining_fresh_reconstruction_queue_before']==3945 and d['remaining_fresh_reconstruction_queue_after']==3942 and d['remaining_queue_types_after']=={'river_group':3412,'lake':530}
 return {'status':'passed','mode':'included_public_files_only','batch':'r42','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':113,'recorded_full_feature_correspondence_reviews_completed':complete,'new_scope_hold_ids':IDS,'new_pending_access_ids':[],'new_pending_material_ids':[IDS[i]for i in sorted(pending)],'generalized_water_identities_supported':0,'bounded_partial_name_associations':2,'label_only_material_pending':len(pending),'unnamed_identity_extent_holds':1,'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':123,'recorded_target_types':{'river_group':43,'lake':80},'remaining_unrecorded_targets':3942,'cumulative_scope_hold_count':39,'pending_access_count':2,'pending_material_count':1+len(pending),'pending_any_count':3+len(pending),'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Access, material and naming-scope states remain distinct. Exact extents and product naming remain unapproved.'}


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r42' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r42' and manifest['scope'] == 'included_public_files_only'
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
