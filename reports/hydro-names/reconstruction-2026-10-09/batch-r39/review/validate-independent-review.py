#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted map/full-geometry judgments are not replayed."""
import hashlib, json, re, sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent
IDS = ['lakes_base:1159109819', 'lakes_base:1159109421', 'lakes_base:1159109285']
NAMES = [[], ['Loon Lake'], ['Primrose Lake']]
FEATURE_SOURCES = [[], ['manitoba_bedrock_geology_of2024_4'], ['wsa_completed_watershed_plans_2014']]
CONTEXT_SOURCES = [['wsa_completed_watershed_plans_2014', 'elections_saskatchewan_cumberland_ge30'], ['wsa_completed_watershed_plans_2014'], []]
LOCATIONS = ['Northern Saskatchewan, Canada, in the east-west selected water immediately east of the Stanley Mission settlement', 'Saskatchewan-Manitoba border, Canada, at the selected ring crossing the Loon Lake-labelled eastern water', 'Saskatchewan-Alberta border, Canada, at the Primrose Lake-labelled basin with a western southwest tip beyond retained map coverage']
EXTENT_LIMITS = ['No selected-water name is established for the complete narrow east-west footprint immediately east of Stanley Mission. The coarse ring follows only part of branching water, includes mapped land and omits continuations. The black Stanley Mission label denotes the settlement. Neither apparent water connection nor surrounding lake labels establishes this selected water identity.', 'Loon Lake is supported only as a bounded local association in the mapped eastern arm. Complementary Saskatchewan and Manitoba maps cover opposite sides of the selected cross-border ring. The western and southwestern continuation is unlabelled, and the northern tip beside the Britton Lake-labelled area has no exact named-water partition established. No Britton component or single whole-ring Loon Lake identity is certified.', 'Primrose Lake is supported for the visible main Saskatchewan basin and its visible southwest arm. The far southwestern tip of the complete selected ring crosses into Alberta, where the retained WSA map contains no hydrographic coverage. Missing western original material prevents completion of whole-feature source identity review. The partial association cannot establish the name of the whole ring.']
UNRESOLVED = [['Whole selected east-west water: no selected-water name or exact relation to surrounding named waters established'], ['Western and southwestern selected continuation and northern tip: exact naming scope unresolved'], ['Alberta-side far southwestern tip: original hydrographic material absent']]
ASSOCIATION_SCOPES = [[], ['Eastern mapped selected-water association only; western/southwestern continuation and northern tip unresolved'], ['Visible Saskatchewan main basin and southwest arm only; Alberta-side tip lacks source coverage']]
FIDS, LOGICAL, POSITIONS = [15445,15416,15404], [4070,4041,4029], [30,34,56]
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '27ce194f34a32629fb01e6e3406d8ca458099443'
GEOMETRY_FILES = {'geometry-reference.json','selected-inventory-records.json','geometry-duplicate-check.json','geometry-publication-rights.json','geometry-README.md','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json','geometry-component-manifest.json'}
REVIEW_FILES = {'README.md','independent-review.json','source-observations.json','public-input-pins.json','review-validation.json','review-manifest.json','validate-independent-review.py','test-independent-review.py'}
DOCUMENTS = {'review':'review/independent-review.json','source':'review/source-observations.json','geometry':'geometry-reference.json','inventory':'selected-inventory-records.json','continuity':'geometry-duplicate-check.json'}
PUBLICATION_KEYS = ['manitoba_bedrock_geology_of2024_4','wsa_completed_watershed_plans_2014','elections_saskatchewan_cumberland_ge30']
PUBLICATION_URLS = ['https://gov.mb.ca/iem/explore/files/geology_of_manitoba_map.pdf','https://wsask.ca/wp-content/uploads/2025/05/WSA_Completed_Planning_Areas_22x34-1.pdf','https://cdn.elections.sk.ca/maps-ge30/Cumberland_GE30.pdf']
ACQUISITIONS = ['2026-10-10T00:02:56.872607+00:00','2026-10-09T13:17:20.296694+00:00','2026-10-09T17:19:27.981345+00:00']
CATEGORIES = ['candidate_waterbody_identity_extent_hold', 'candidate_waterbody_identity_extent_hold', 'source_coverage_incomplete']
STATUSES = ['unresolved_water_identity_and_extent_scalar_name_hold', 'partial_named_water_association_scalar_name_hold', 'partial_named_water_association_missing_source_coverage']
ROLES = ['no_named_candidate_established_for_selected_water', 'bounded_eastern_selected_water_association_only', 'bounded_visible_saskatchewan_association_only']


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
    for d in [review,source,geometry,continuity]:assert d['batch']=='r39'
    for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
    assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
    stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
    assert review['prior_distinct_targets']==111 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==114 and review['duplicate_targets']==0
    assert review['current_batch_full_feature_correspondence_reviews_completed']==2 and review['current_batch_source_limited_targets']==1 and review['current_batch_source_material_pending_targets']==1
    assert review['current_batch_follow_up_required_targets']==3 and review['current_batch_scope_hold_targets']==2
    assert review['independent_source_comparison_completed']is True and review['scalar_product_name_approvals']==0
    for k in ['automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','pending_access_reassessment_performed','prior_target_source_or_geometry_reaudit_performed','private_original_packed_decoder_independently_replayed']:assert review[k]is False
    history=review['historical_review'];assert timestamp(history['performed_at_utc'])==stamp
    assert history['available_source_inspection_completed']is True and history['full_feature_correspondence_review_completed']is False
    assert history['full_feature_correspondence_review_completed_count']==2 and history['source_material_pending_count']==1
    for k in ['original_source_material_included','full_selected_geometry_included','historical_results_recomputed_by_public_validator']:assert history[k]is False
    assert source['new_external_requests']==source['new_external_requests_by_independent_reviewer']==source['backend_http_subrequest_count']==source['new_original_source_acquisitions_this_batch']==0
    assert source['external_request_count_unit']=='known_high_level_calls' and source['new_external_requests_scope']
    assert source['distinct_reviewed_publications']==source['independent_source_groups']==3 and source['distinct_cartographic_identity_publications']==2
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
        assert p['directly_read_water_labels']==[['Loon Lake'],['Primrose Lake'],[]][i]
        for k in ['title','publisher','own_observations','role','authority_scope','publication_date_note','cartographic_credit_observed']:assert p[k]
    assert pubs[0]['nearby_distinct_water_labels']==['Britton Lake','Sisipuk Lake']
    assert 'CanVec+'in pubs[0]['cartographic_credit_observed']
    assert pubs[1]['printed_production_date']=='2014-11-25' and pubs[1]['printed_production_date_precision']=='day' and pubs[1]['printed_production_date_verified']is True
    assert pubs[1]['nearby_distinct_water_labels']==['Otter Lake']
    assert pubs[2]['nearby_distinct_water_labels']==['Forrester Lake','Coghill Lake','Baldwin Lake','Penney Lake']
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
        assert f['source_access_limited']is False and f['full_feature_correspondence_review_completed']is(i!=2) and f['source_and_rendered_full_footprints_compared']is True and o['entire_selected_source_and_rendered_polygons_viewed']is True
        assert f['source_observation_id']==o['observation_id']==f['aw_id'] and o['independent_observation']
        assert f['supported_name_scope'] and f['limits'] and f['follow_up_scope'] and f['geographic_disambiguation']==LOCATIONS[i]
        assert f['candidate_names']==f['directly_supported_name_forms']==NAMES[i] and f['candidate_name']is None
        assert f['source_material_pending']is(i==2) and f['complete_source_map_coverage_available']is(i!=2) and f['complete_geometry_inspection_performed']is True
        assert o['source_material_pending']is(i==2) and o['complete_source_map_coverage_available']is(i!=2) and o['full_feature_source_identity_review_completed']is(i!=2)
        assert f['research_category']==CATEGORIES[i] and f['review_status']==STATUSES[i] and f['candidate_name_role']==ROLES[i]
        assert f['follow_up_required']is True and f['registered_overlay_performed']is True
        c=f['name_confidence'];assert c['direct_label_reading']==('no_selected_water_label_established'if i==0 else'high') and c['local_named_water_association']==('unresolved'if i==0 else'high_bounded_partial')
        assert c['whole_selected_single_name']==['unresolved_identity_and_extent','unresolved_named_extent','unverified_missing_source_coverage'][i] and c['exact_named_extent']=='unverified' and c['basis']
        assert f['selection_origin']=='new_inventory_investigation'
        for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','korean_name','name_en','name_original']:assert f[k]is None
        for k in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified','exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:assert f[k]is False
        s=f['naming_scope_details'];assert s['selected_polygon_count']==1 and s['separately_labelled_water_names']==NAMES[i] and s['multiple_named_lakes_in_one_polygon']is False
        for k in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','supported_component_names_exhaustive']:assert s[k]is False
        for k in ['whole_polygon_scalar_application_approved','precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed','component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed','entire_detailed_named_lake_representation_verified']:assert s[k]is False
        assert s['material_extent_limit']==EXTENT_LIMITS[i] and EXTENT_LIMITS[i]in f['supported_name_scope'] and EXTENT_LIMITS[i]in f['limits']
        assert s['unresolved_selected_parts']==[] and s['unresolved_named_extents']==UNRESOLVED[i]
        assert [a['name']for a in s['supported_component_associations']]==NAMES[i] and [a['scope']for a in s['supported_component_associations']]==ASSOCIATION_SCOPES[i]
    holds=[f['aw_id']for f in review['findings']if f['research_category']in {'compound_feature_name_scope_hold','candidate_waterbody_identity_extent_hold'}]
    assert holds==review['new_scope_hold_ids']==IDS[:2] and review['new_pending_access_ids']==[]
    assert review['new_pending_material_ids']==[IDS[2]] and review['preserved_pending_material_ids']==[]
    assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
    assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==34
    previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==111
    assert set(review['preserved_pending_access_ids']+review['preserved_scope_hold_ids'])<=set(previous) and set(previous).isdisjoint(IDS)
    assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
    assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r38/reconstruction-index.json'
    d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==111 and d['reconstructed_target_count_after']==114 and d['initial_eligible_target_count']==4065
    assert d['remaining_fresh_reconstruction_queue_before']==3954 and d['remaining_fresh_reconstruction_queue_after']==3951 and d['remaining_queue_types_after']=={'river_group':3412,'lake':539}
    return {'status':'passed','mode':'included_public_files_only','batch':'r39','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':120,'recorded_full_feature_correspondence_reviews_completed':2,'new_scope_hold_ids':holds,'new_pending_material_ids':[IDS[2]],'generalized_water_identities_supported':0,'bounded_partial_name_associations':2,'unnamed_identity_extent_holds':1,'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':114,'remaining_unrecorded_targets':3951,'cumulative_scope_hold_count':36,'pending_access_count':2,'pending_material_count':1,'pending_any_count':3,'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Unnamed Stanley Mission-area water and partial Loon association are scope holds. Partial Primrose association has missing Alberta material, separate from access failure; whole-feature source identity review is incomplete. Exact extents and product naming remain unapproved.'}



def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r39' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r39' and manifest['scope'] == 'included_public_files_only'
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
