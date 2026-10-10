#!/usr/bin/env python3
"""Check included lake-review facts and bytes; omitted map/polygon judgments are not replayed."""
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent
IDS = ['lakes_base:1159109455', 'lakes_base:1159109439', 'lakes_base:1159109395']
FIDS, LOGICAL, POSITIONS = [15418, 15417, 15414], [4043, 4042, 4039], [115, 40, 102]
PART_COUNTS = [1, 1, 1]
RING_POSITIONS = [[[115]], [[40]], [[102]]]
NAMES = [['Highrock Lake', 'Nelson Lake'], ['Sisipuk Lake'], ['Granville Lake']]
SOURCES = ['manitoba_bedrock_geology_of2024_4']
FEATURE_SOURCES = [SOURCES, SOURCES, SOURCES]
CONTEXT_SOURCES = [[], ['wsa_completed_watershed_plans_2014'], []]
LOCATIONS = ['Northwestern Manitoba, Canada, in the Highrock and Nelson lake region south of Granville Lake', 'Manitoba-Saskatchewan border, Canada, at the Sisipuk Lake eastern basin northeast of Sandy Bay', 'Northwestern Manitoba, Canada, at Granville Lake southwest of Leaf Rapids']
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '79a45a336290eab5373d13d8af2e1f6730ae9dcd'
GEOMETRY_FILES = {
    'geometry-reference.json', 'selected-inventory-records.json', 'geometry-duplicate-check.json',
    'geometry-publication-rights.json', 'geometry-README.md', 'validate-geometry-reference.py',
    'test-geometry-reference.py', 'geometry-validation.json', 'geometry-component-manifest.json',
}
REVIEW_FILES = {
    'README.md', 'independent-review.json', 'source-observations.json', 'public-input-pins.json',
    'review-validation.json', 'review-manifest.json', 'validate-independent-review.py', 'test-independent-review.py',
}
DOCUMENTS = {
    'review': 'review/independent-review.json', 'source': 'review/source-observations.json',
    'geometry': 'geometry-reference.json', 'inventory': 'selected-inventory-records.json',
    'continuity': 'geometry-duplicate-check.json',
}


def load_records():
    return {key: json.loads((PUBLIC / name).read_text()) for key, name in DOCUMENTS.items()}


def verify_bytes(body, pin):
    assert len(body) == pin['bytes'] and hashlib.sha256(body).hexdigest() == pin['sha256']


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    assert result.utcoffset() is not None
    return result


def reject_payload(value):
    if isinstance(value, dict):
        for key, child in value.items():
            assert key not in {'coordinates', 'coordinate_arrays', 'part_endpoints', 'cache_dir'}
            assert not any(token in key.lower() for token in ['sha256', 'fingerprint', 'checksum'])
            reject_payload(child)
    elif isinstance(value, list):
        for child in value:
            reject_payload(child)
    elif isinstance(value, str):
        assert not re.search(r'/(?:workspace|tmp)/|(?:local-review|input-cache)/', value)


EXTENT_LIMITS = ['The single selected ring combines Highrock Lake and Nelson Lake associations, which are non-exhaustive. The northern arm has unresolved named-water scope; proximity to the Suwannee Lake label does not establish a Suwannee component. Western Highrock bays and detailed southern and eastern continuations lie outside the selected ring, while coarse margins cross mapped land. Exact component partitions and complete detailed named-lake extents remain unverified.', 'Sisipuk Lake is supported for the eastern Manitoba basin only. The western selected portion is outside Manitoba-map hydrographic coverage. The complementary Saskatchewan WSA map shows branching western border waters without a selected water-name label; its Manitoba side is blank. Neither map establishes the whole cross-border named extent. Exact western named-water scope, islands, shoreline and detailed lake coverage remain unverified.', 'Granville Lake is supported for the main basin, western lobes and northeastern arm only. The pronounced southern prong follows the Laurie-labelled corridor beyond the broad lake basin and crosses mapped land, with no exact lake/river name assignment established. The separately labelled Costello Lake basin lies east and is not a supported component of the prong. Detailed northern and northeastern continuations, islands, bays and exact named-water transitions remain unverified.']
UNRESOLVED = [['Northern arm near Suwannee Lake; no exact name assignment established'], ['Western cross-border portion; water-name scope not established by the complementary maps'], ['Southern prong along the Laurie-labelled corridor; exact lake/river name assignment unverified']]
ASSOCIATION_SCOPES = [['Central and southern named-water association in the single 115-position selected ring', 'Eastern named-water association in the single 115-position selected ring'], ['Eastern Manitoba basin of the single 40-position cross-border selected ring'], ['Main basin, western lobes and northeastern arm of the single 102-position selected ring']]
CATEGORIES = ['compound_feature_name_scope_hold', 'candidate_waterbody_identity_extent_hold', 'candidate_waterbody_identity_extent_hold']
PUBLICATION_KEYS = ['manitoba_bedrock_geology_of2024_4', 'wsa_completed_watershed_plans_2014']
PUBLICATION_URLS = ['https://gov.mb.ca/iem/explore/files/geology_of_manitoba_map.pdf', 'https://wsask.ca/wp-content/uploads/2025/05/WSA_Completed_Planning_Areas_22x34-1.pdf']
ACQUISITIONS = ['2026-10-10T00:02:56.872607+00:00', '2026-10-09T13:17:20.296694+00:00']

def validate_records(data):
    review, source, geometry, inventory, continuity = (data[key] for key in DOCUMENTS)
    reject_payload(review); reject_payload(source)
    for document in [review, source, geometry, continuity]: assert document['batch'] == 'r37'
    for document in [review, source, geometry, inventory]: assert document['scope_aw_ids'] == IDS
    assert review['baseline_commit'] == geometry['baseline']['git_commit'] == BASELINE
    stamp = timestamp(review['reviewed_at_utc']); timestamp(geometry['created_at_utc'])
    assert review['prior_distinct_targets'] == 105 and review['current_batch_increment'] == 3
    assert review['cumulative_distinct_targets'] == 108 and review['duplicate_targets'] == 0
    assert review['current_batch_full_feature_correspondence_reviews_completed'] == 3
    assert review['current_batch_source_limited_targets'] == 0
    assert review['current_batch_follow_up_required_targets'] == review['current_batch_scope_hold_targets'] == 3
    assert review['independent_source_comparison_completed'] is True and review['scalar_product_name_approvals'] == 0
    for key in ['automatic_application','product_application','geometry_modified','topology_repaired',
                'current_live_deployment_checked','historical_verdicts_restored','pending_access_reassessment_performed',
                'prior_target_source_or_geometry_reaudit_performed','private_original_packed_decoder_independently_replayed']:
        assert review[key] is False
    historical = review['historical_review']; assert timestamp(historical['performed_at_utc']) == stamp
    assert historical['available_source_inspection_completed'] is True and historical['full_feature_correspondence_review_completed'] is True
    for key in ['original_source_material_included','full_selected_geometry_included','historical_results_recomputed_by_public_validator']:
        assert historical[key] is False
    assert source['new_external_requests'] == source['new_external_requests_by_independent_reviewer'] == 0
    assert source['external_request_count_unit'] == 'known_high_level_calls' and source['backend_http_subrequest_count'] == 0
    assert source['new_original_source_acquisitions_this_batch'] == 0 and source['new_external_requests_scope']
    assert source['distinct_reviewed_publications'] == source['independent_source_groups'] == 2
    assert source['distinct_cartographic_identity_publications'] == 1
    assert source['independent_review_and_source_research_agree'] is True
    assert source['registered_overlay_performed'] is True and source['registration_limit'] and source['source_group_definition']
    for key in ['underlying_hydrographic_dataset_independence_verified','formal_registry_verified']: assert source[key] is False
    publications = source['observations']; assert len(publications) == 2
    assert [x['source_key']for x in publications] == PUBLICATION_KEYS
    for i,publication in enumerate(publications):
        assert publication['url'] == PUBLICATION_URLS[i] and publication['original_acquired_at_utc'] == ACQUISITIONS[i]
        assert timestamp(publication['original_acquired_at_utc']) <= stamp
        assert publication['acquisition_http_status'] == 200 and publication['original_acquisition_receipt_reviewed'] is True
        for key in ['retrieved_this_batch','review_reused_original_acquired_earlier_this_batch','is_formal_naming_registry']: assert publication[key] is False
        for key in ['reused_original','review_reused_original_acquired_in_prior_batch','original_map_pixels_viewed','registered_overlay_performed']: assert publication[key] is True
        assert publication['original_acquisition_batch'] == ('r34' if i == 0 else None)
        assert publication['publication_date'] == ['2024',None][i]
        assert publication['publication_date_verified'] is (i == 0)
        assert publication['publication_date_precision'] == ['year','unknown'][i]
        if i == 1:
            assert publication['printed_production_date'] == '2014-11-25'
            assert publication['printed_production_date_precision'] == 'day' and publication['printed_production_date_verified'] is True
        assert publication['physical_pdf_pages'] == [1]
        assert publication['directly_read_water_labels'] == ([n for names in NAMES for n in names] if i == 0 else [])
        for key in ['title','publisher','own_observations','role','authority_scope','publication_date_note','cartographic_credit_observed']: assert publication[key]
        assert publication['printed_scale'] == ['1:1,000,000','1:1,750,000'][i]
    assert 'CanVec+' in publications[0]['cartographic_credit_observed']
    assert set(publications[0]['nearby_distinct_water_labels']) == {'Suwannee Lake','Flatrock Lake','Costello Lake','Laurie River','Loon Lake','Britton Lake','Chicken Lake','Eden Lake'}
    assert publications[1]['nearby_distinct_water_labels'] == [] and publications[1]['original_acquisition_batch_note']
    columns = [review['findings'],source['complete_feature_observations'],geometry['selected_features'],inventory['records']]
    for column in columns: assert [item['aw_id']for item in column] == IDS
    for i,(finding,observation,feature,row) in enumerate(zip(*columns)):
        compound = i == 0
        for item in [finding,observation,feature,row]: assert item['source_id'] == IDS[i].split(':')[1]
        assert finding['baseline_logical_fid'] == feature['baseline_logical_fid'] == row['logical_fid'] == LOGICAL[i]
        assert feature['baseline_fid'] == FIDS[i]
        for item in [finding,observation,row]: assert item['geometry_fids'] == [FIDS[i]]
        assert finding['fragment_count'] == feature['fragment_count'] == row['geometry_count'] == 1
        for item in [finding,observation]:
            assert item['polygon_part_count'] == item['ring_count'] == 1
            assert item['position_count_including_closure'] == POSITIONS[i] and item['all_selected_parts_and_rings_considered'] is True
        for key in ['source_geometry','baseline_rendered_geometry']:
            summary = feature[key]
            assert summary['type'] == 'Polygon' and summary['polygon_part_count'] == 1
            assert summary['ring_counts_by_part'] == [1] and summary['coordinate_counts_by_part_and_ring'] == RING_POSITIONS[i]
            assert summary['total_coordinates_including_closure'] == POSITIONS[i] and summary['all_rings_closed'] is True
        assert row['bbox'] == feature['baseline_rendered_geometry']['bbox']
        assert finding['category'] == row['category'] == 'lake'
        assert finding['source_keys'] == observation['source_keys'] == SOURCES
        assert finding['context_source_keys'] == observation['context_source_keys'] == CONTEXT_SOURCES[i]
        assert finding['source_access_limited'] is False and finding['full_feature_correspondence_review_completed'] is True
        assert finding['source_and_rendered_full_footprints_compared'] is True and observation['entire_selected_source_and_rendered_polygons_viewed'] is True
        assert finding['source_observation_id'] == observation['observation_id'] == finding['aw_id'] and observation['independent_observation']
        assert finding['supported_name_scope'] and finding['limits'] and finding['follow_up_scope']
        assert finding['geographic_disambiguation'] == LOCATIONS[i]
        assert finding['candidate_names'] == finding['directly_supported_name_forms'] == NAMES[i] and finding['candidate_name'] is None
        assert finding['research_category'] == CATEGORIES[i]
        assert finding['review_status'] == ('multiple_named_waters_scalar_name_hold' if compound else 'partial_identity_unresolved_extent_scalar_name_hold')
        assert finding['candidate_name_role'] == ('no_single_candidate_for_compound_footprint' if compound else 'partial_named_water_association_whole_feature_unresolved')
        assert finding['follow_up_required'] is True and finding['registered_overlay_performed'] is True
        confidence = finding['name_confidence']; assert confidence['direct_label_reading'] == confidence['local_named_water_association'] == 'high'
        assert confidence['whole_selected_single_name'] == ('not_supported_compound_scope' if compound else 'unresolved_named_extent')
        assert confidence['exact_named_extent'] == 'unverified' and confidence['basis']
        assert finding['selection_origin'] == 'new_inventory_investigation'
        for key in ['whole_feature_scalar_name','scalar_product_name','name_ko','korean_name','name_en','name_original']: assert finding[key] is None
        for key in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified',
                    'exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:
            assert finding[key] is False
        scope = finding['naming_scope_details']; assert scope['selected_polygon_count'] == 1 and scope['separately_labelled_water_names'] == NAMES[i]
        assert scope['multiple_named_lakes_in_one_polygon'] is compound
        for key in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','whole_polygon_scalar_application_approved',
                    'precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed',
                    'component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed',
                    'entire_detailed_named_lake_representation_verified','supported_component_names_exhaustive']:
            assert scope[key] is False
        assert scope['material_extent_limit'] == EXTENT_LIMITS[i] and EXTENT_LIMITS[i] in finding['supported_name_scope'] and EXTENT_LIMITS[i] in finding['limits']
        assert scope['unresolved_selected_parts'] == [] and scope['unresolved_named_extents'] == UNRESOLVED[i]
        associations = scope['supported_component_associations']; assert [x['name']for x in associations] == NAMES[i]
        assert [x['scope']for x in associations] == ASSOCIATION_SCOPES[i]
    holds = [x['aw_id']for x in review['findings'] if x['research_category'] in {'compound_feature_name_scope_hold','candidate_waterbody_identity_extent_hold'}]
    assert holds == review['new_scope_hold_ids'] == IDS and review['new_pending_access_ids'] == []
    assert review['preserved_pending_access_ids'] == continuity['preserved_pending_access_ids'] == ['lakes_base:1159112821','lakes_base:1159108815']
    assert review['preserved_scope_hold_ids'] == continuity['preserved_scope_hold_ids']
    assert len(set(review['preserved_scope_hold_ids'])) == len(review['preserved_scope_hold_ids']) == 29
    previous = continuity['previous_aw_ids_in_index_order']
    assert len(previous) == len(set(previous)) == continuity['previous_target_count'] == 105
    assert set(review['preserved_pending_access_ids'] + review['preserved_scope_hold_ids']) <= set(previous)
    assert set(previous).isdisjoint(IDS) and continuity['selected_aw_ids'] == IDS
    assert continuity['intersection_aw_ids'] == [] and continuity['prior_index_duplicate_count'] == 0
    assert continuity['selected_unique_count'] == 3 and continuity['prior_targets_reassessed'] is False
    assert continuity['previous_index_immutable_url'] == 'https://github.com/kimjeon-il/Pando/blob/' + PRIOR + '/reports/hydro-names/reconstruction-2026-10-09/batch-r36/reconstruction-index.json'
    delta = continuity['current_batch_delta']
    assert delta['new_distinct_target_increment'] == 3 and delta['reconstructed_target_count_before'] == 105
    assert delta['reconstructed_target_count_after'] == 108 and delta['initial_eligible_target_count'] == 4065
    assert delta['remaining_fresh_reconstruction_queue_before'] == 3960 and delta['remaining_fresh_reconstruction_queue_after'] == 3957
    assert delta['remaining_queue_types_after'] == {'river_group':3412,'lake':545}
    return {
        'status':'passed','mode':'included_public_files_only','batch':'r37','scope_aw_ids':IDS,
        'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,
        'recorded_position_count_including_closures':257,'recorded_full_feature_correspondence_reviews_completed':3,
        'new_scope_hold_ids':holds,'generalized_water_identities_supported':0,'distinct_target_increment':3,'existing_targets_reassessed':0,
        'recorded_cumulative_distinct_targets':108,'remaining_unrecorded_targets':3957,
        'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,
        'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,
        'limit':'Included facts and byte consistency only. Source/map/polygon judgments are recorded, not replayed. Three scope holds: non-exhaustive Highrock/Nelson components with northern-arm scope unresolved; eastern Sisipuk association with western cross-border scope unresolved; Granville association with southern-prong river/lake scope unresolved. Two retained publications, one selected-water naming source. No new access-pending target. Exact named extents and product naming remain unapproved.',
    }


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r37' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r37' and manifest['scope'] == 'included_public_files_only'
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
