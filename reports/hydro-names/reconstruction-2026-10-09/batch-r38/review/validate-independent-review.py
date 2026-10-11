#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted map/full-geometry judgments are not replayed."""
import hashlib, json, re, sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent
IDS = ['lakes_base:1159112221', 'lakes_base:1159110309', 'lakes_base:1159112237']
NAMES = [['Misty Lake', 'Lac Brochet'], ['Kasmere Lake'], []]
FEATURE_SOURCES = [['manitoba_bedrock_geology_of2024_4'], ['manitoba_bedrock_geology_of2024_4'], []]
CONTEXT_SOURCES = [[], [], ['wsa_completed_watershed_plans_2014', 'elections_saskatchewan_cumberland_ge30']]
LOCATIONS = ['Northwestern Manitoba, Canada, in the Misty Lake and Lac Brochet region east of the Saskatchewan boundary', 'Northern Manitoba, Canada, at Kasmere Lake south of Tice Lake', 'Northern Saskatchewan, Canada, at the western branched water lobe west of the Bannock-labelled eastern water']
EXTENT_LIMITS = ['The single selected ring combines the northern Misty Lake association and southern Lac Brochet association. These are non-exhaustive component associations. The intervening narrow corridor and southwest corner beside Kingsley Lake have no exact named-water partition established. The coarse ring crosses mapped land and omits substantial northern, western and eastern detailed continuations. Entire detailed named-lake extents remain unverified.', 'The complete selected generalized footprint follows the principal Kasmere Lake basin, northwestern lobe, northeastern head and southern prong. Coarse margins cross mapped land and omit detailed bays, the eastern/northeastern continuation and the southwestern narrow outlet. Islands, shoreline and exact adjoining-water transitions are generalized; complete detailed named-lake representation remains unverified.', 'No selected-water name is established for the complete triangular western-lobe footprint. Both retained Saskatchewan maps place Bannock Lake on the separately depicted eastern narrow water, outside the selected ring. The selected ring covers only part of a much larger western branched water and includes mapped land between inlets. Northern, eastern and southwestern continuations extend beyond it. Neither the named identity nor the named-water partition of the selected lobe is resolved.']
UNRESOLVED = [['Intervening narrow corridor and southwest corner beside Kingsley Lake; precise named-water partitions unverified'], [], ['Whole selected western lobe: no selected-water name or exact relationship to the surrounding named waters established']]
ASSOCIATION_SCOPES = [['Northern named-water association in the single 61-position selected ring', 'Southern named-water association in the single 61-position selected ring'], ['Complete selected generalized footprint with stated material extent limits'], []]
FIDS, LOGICAL, POSITIONS = [15605,15481,15607], [4230,4106,4232], [61,49,20]
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '26f27a67f57168a19e5dca14b46296ffb82fcfda'
GEOMETRY_FILES = {'geometry-reference.json','selected-inventory-records.json','geometry-duplicate-check.json','geometry-publication-rights.json','geometry-README.md','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json','geometry-component-manifest.json'}
REVIEW_FILES = {'README.md','independent-review.json','source-observations.json','public-input-pins.json','review-validation.json','review-manifest.json','validate-independent-review.py','test-independent-review.py'}
DOCUMENTS = {'review':'review/independent-review.json','source':'review/source-observations.json','geometry':'geometry-reference.json','inventory':'selected-inventory-records.json','continuity':'geometry-duplicate-check.json'}
PUBLICATION_KEYS = ['manitoba_bedrock_geology_of2024_4','wsa_completed_watershed_plans_2014','elections_saskatchewan_cumberland_ge30']
PUBLICATION_URLS = ['https://gov.mb.ca/iem/explore/files/geology_of_manitoba_map.pdf','https://wsask.ca/wp-content/uploads/2025/05/WSA_Completed_Planning_Areas_22x34-1.pdf','https://cdn.elections.sk.ca/maps-ge30/Cumberland_GE30.pdf']
ACQUISITIONS = ['2026-10-10T00:02:56.872607+00:00','2026-10-09T13:17:20.296694+00:00','2026-10-09T17:19:27.981345+00:00']
CATEGORIES = ['compound_feature_name_scope_hold','supported_generalized_water_identity','candidate_waterbody_identity_extent_hold']
STATUSES = ['multiple_named_waters_scalar_name_hold','generalized_identity_supported_not_product_name_clearance','unresolved_water_identity_and_extent_scalar_name_hold']
ROLES = ['no_single_candidate_for_compound_footprint','bounded_generalized_selected_water_footprint_identity','no_named_candidate_established_for_selected_water']


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
    review,source,geometry,inventory,continuity=(data[k]for k in DOCUMENTS)
    reject_payload(review);reject_payload(source)
    for d in [review,source,geometry,continuity]:assert d['batch']=='r38'
    for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
    assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
    stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
    assert review['prior_distinct_targets']==108 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==111 and review['duplicate_targets']==0
    assert review['current_batch_full_feature_correspondence_reviews_completed']==3 and review['current_batch_source_limited_targets']==0
    assert review['current_batch_follow_up_required_targets']==review['current_batch_scope_hold_targets']==2
    assert review['independent_source_comparison_completed']is True and review['scalar_product_name_approvals']==0
    for k in ['automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','pending_access_reassessment_performed','prior_target_source_or_geometry_reaudit_performed','private_original_packed_decoder_independently_replayed']:assert review[k]is False
    history=review['historical_review'];assert timestamp(history['performed_at_utc'])==stamp
    for k in ['available_source_inspection_completed','full_feature_correspondence_review_completed']:assert history[k]is True
    for k in ['original_source_material_included','full_selected_geometry_included','historical_results_recomputed_by_public_validator']:assert history[k]is False
    assert source['new_external_requests']==source['new_external_requests_by_independent_reviewer']==source['backend_http_subrequest_count']==source['new_original_source_acquisitions_this_batch']==0
    assert source['external_request_count_unit']=='known_high_level_calls' and source['new_external_requests_scope']
    assert source['distinct_reviewed_publications']==source['independent_source_groups']==3 and source['distinct_cartographic_identity_publications']==1
    assert source['independent_review_and_source_research_agree']is True and source['registered_overlay_performed']is True
    for k in ['registration_limit','source_group_definition','source_group_limit']:assert source[k]
    for k in ['underlying_hydrographic_dataset_independence_verified','formal_registry_verified']:assert source[k]is False
    pubs=source['observations'];assert len(pubs)==3 and [p['source_key']for p in pubs]==PUBLICATION_KEYS
    for i,p in enumerate(pubs):
        assert p['url']==PUBLICATION_URLS[i] and p['original_acquired_at_utc']==ACQUISITIONS[i] and timestamp(p['original_acquired_at_utc'])<=stamp
        assert p['acquisition_http_status']==200 and p['original_acquisition_receipt_reviewed']is True
        for k in ['retrieved_this_batch','review_reused_original_acquired_earlier_this_batch','is_formal_naming_registry']:assert p[k]is False
        for k in ['reused_original','review_reused_original_acquired_in_prior_batch','original_map_pixels_viewed','registered_overlay_performed']:assert p[k]is True
        assert p['publication_date']==['2024',None,None][i] and p['publication_date_precision']==['year','unknown','unknown'][i] and p['publication_date_verified']is(i==0)
        assert p['original_acquisition_batch']==['r34',None,None][i]
        assert p['physical_pdf_pages']==[1] and p['printed_scale']==['1:1,000,000','1:1,750,000',None][i]
        assert p['directly_read_water_labels']==(['Misty Lake','Lac Brochet','Kasmere Lake']if i==0 else [])
        for k in ['title','publisher','own_observations','role','authority_scope','publication_date_note','cartographic_credit_observed']:assert p[k]
    assert pubs[0]['nearby_distinct_water_labels']==['Kingsley Lake','Waspison Lake','Whiskey Jack Lake','Cochrane River','Tice Lake','Koona Lake','Snyder Lake']
    assert 'CanVec+'in pubs[0]['cartographic_credit_observed']
    assert pubs[1]['printed_production_date']=='2014-11-25' and pubs[1]['printed_production_date_precision']=='day' and pubs[1]['printed_production_date_verified']is True
    assert pubs[1]['nearby_distinct_water_labels']==['Bannock Lake','Kingston Lake','Bentley Lake','Charcoal Lake','Wollaston']
    assert pubs[2]['nearby_distinct_water_labels']==['Bannock Lake','Kingston Lake','Bentley Lake','Charcoal Lake','Watson Lake']
    assert pubs[2]['original_acquisition_timestamp_basis']=='Receipt recorded-at time; no separately recorded response-completion timestamp.' and pubs[2]['original_requested_at_utc']=='2026-10-09T17:19:23.772516+00:00'
    assert pubs[2]['printed_creation_date_text']=='02/10/2023' and pubs[2]['printed_creation_date_order']=='ambiguous' and pubs[2]['printed_creation_date_normalized']is None and pubs[2]['printed_creation_date_verified']is True
    for p in pubs[1:]:assert p['original_acquisition_batch_note']
    columns=[review['findings'],source['complete_feature_observations'],geometry['selected_features'],inventory['records']]
    for col in columns:assert [r['aw_id']for r in col]==IDS
    for i,(f,o,g,row)in enumerate(zip(*columns)):
        for x in [f,o,g,row]:assert x['source_id']==IDS[i].split(':')[1]
        assert f['baseline_logical_fid']==g['baseline_logical_fid']==row['logical_fid']==LOGICAL[i] and g['baseline_fid']==FIDS[i]
        for x in [f,o,row]:assert x['geometry_fids']==[FIDS[i]]
        assert f['fragment_count']==g['fragment_count']==row['geometry_count']==1
        for x in [f,o]:assert x['polygon_part_count']==x['ring_count']==1 and x['position_count_including_closure']==POSITIONS[i] and x['all_selected_parts_and_rings_considered']is True
        for k in ['source_geometry','baseline_rendered_geometry']:
            s=g[k];assert s['type']=='Polygon' and s['polygon_part_count']==1 and s['ring_counts_by_part']==[1] and s['coordinate_counts_by_part_and_ring']==[[POSITIONS[i]]] and s['total_coordinates_including_closure']==POSITIONS[i] and s['all_rings_closed']is True
        assert row['bbox']==g['baseline_rendered_geometry']['bbox'] and f['category']==row['category']=='lake'
        assert f['source_keys']==o['source_keys']==FEATURE_SOURCES[i] and f['context_source_keys']==o['context_source_keys']==CONTEXT_SOURCES[i]
        assert f['source_access_limited']is False and f['full_feature_correspondence_review_completed']is True and f['source_and_rendered_full_footprints_compared']is True and o['entire_selected_source_and_rendered_polygons_viewed']is True
        assert f['source_observation_id']==o['observation_id']==f['aw_id'] and o['independent_observation']
        assert f['supported_name_scope'] and f['limits'] and f['follow_up_scope'] and f['geographic_disambiguation']==LOCATIONS[i]
        assert f['candidate_names']==f['directly_supported_name_forms']==NAMES[i] and f['candidate_name']==(NAMES[i][0]if i==1 else None)
        assert f['research_category']==CATEGORIES[i] and f['review_status']==STATUSES[i] and f['candidate_name_role']==ROLES[i]
        assert f['follow_up_required']is(i!=1) and f['registered_overlay_performed']is True
        c=f['name_confidence'];assert c['direct_label_reading']==('no_selected_water_label_established'if i==2 else'high') and c['local_named_water_association']==('unresolved'if i==2 else'high')
        assert c['whole_selected_single_name']==['not_supported_compound_scope','supported_at_generalized_scale','unresolved_identity_and_extent'][i] and c['exact_named_extent']=='unverified' and c['basis']
        assert f['selection_origin']=='new_inventory_investigation'
        for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','korean_name','name_en','name_original']:assert f[k]is None
        for k in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified','exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:assert f[k]is False
        s=f['naming_scope_details'];assert s['selected_polygon_count']==1 and s['separately_labelled_water_names']==NAMES[i] and s['multiple_named_lakes_in_one_polygon']is(i==0)
        for k in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','supported_component_names_exhaustive']:assert s[k]is(i==1)
        for k in ['whole_polygon_scalar_application_approved','precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed','component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed','entire_detailed_named_lake_representation_verified']:assert s[k]is False
        assert s['material_extent_limit']==EXTENT_LIMITS[i] and EXTENT_LIMITS[i]in f['supported_name_scope'] and EXTENT_LIMITS[i]in f['limits']
        assert s['unresolved_selected_parts']==[] and s['unresolved_named_extents']==UNRESOLVED[i]
        assert [a['name']for a in s['supported_component_associations']]==NAMES[i] and [a['scope']for a in s['supported_component_associations']]==ASSOCIATION_SCOPES[i]
    holds=[f['aw_id']for f in review['findings']if f['research_category']in {'compound_feature_name_scope_hold','candidate_waterbody_identity_extent_hold'}]
    assert holds==review['new_scope_hold_ids']==[IDS[0],IDS[2]] and review['new_pending_access_ids']==[]
    assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
    assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==32
    previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==108
    assert set(review['preserved_pending_access_ids']+review['preserved_scope_hold_ids'])<=set(previous) and set(previous).isdisjoint(IDS)
    assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
    assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r37/reconstruction-index.json'
    d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==108 and d['reconstructed_target_count_after']==111 and d['initial_eligible_target_count']==4065
    assert d['remaining_fresh_reconstruction_queue_before']==3957 and d['remaining_fresh_reconstruction_queue_after']==3954 and d['remaining_queue_types_after']=={'river_group':3412,'lake':542}
    return {'status':'passed','mode':'included_public_files_only','batch':'r38','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':130,'recorded_full_feature_correspondence_reviews_completed':3,'new_scope_hold_ids':holds,'generalized_water_identities_supported':1,'unnamed_identity_extent_holds':1,'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':111,'remaining_unrecorded_targets':3954,'cumulative_scope_hold_count':34,'pending_access_count':2,'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Misty/Lac Brochet compound hold; Kasmere bounded generalized identity; unnamed western-lobe identity/extent hold. Bannock proximity is not selected-water naming evidence. No new access-pending target. Exact extents and product naming remain unapproved.'}


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r38' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r38' and manifest['scope'] == 'included_public_files_only'
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
