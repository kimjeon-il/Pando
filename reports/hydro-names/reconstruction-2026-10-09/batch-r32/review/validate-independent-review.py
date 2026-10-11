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
IDS = ['lakes_base:1159107927', 'lakes_base:1159110635', 'lakes_base:1159107889']
FIDS, LOGICAL, POSITIONS = [15300, 15502, 15297], [3925, 4127, 3922], [84, 31, 25]
NAMES = [['Lake Nerka'], ['Lake Aleknagik'], ['Nunavaugaluk Lake']]
SOURCE = 'alaska_dnr_hosted_wood_tikchik_topo_map'
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = 'fa2211478a6f1d0d05128faada49a6a28491519e'
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


def validate_records(data):
    review, source, geometry, inventory, continuity = (data[key] for key in DOCUMENTS)
    reject_payload(review)
    reject_payload(source)
    for document in [review, source, geometry, continuity]:
        assert document['batch'] == 'r32'
    for document in [review, source, geometry, inventory]:
        assert document['scope_aw_ids'] == IDS
    assert review['baseline_commit'] == geometry['baseline']['git_commit'] == BASELINE
    stamp = timestamp(review['reviewed_at_utc'])
    timestamp(geometry['created_at_utc'])
    assert review['prior_distinct_targets'] == 90 and review['current_batch_increment'] == 3
    assert review['cumulative_distinct_targets'] == 93 and review['duplicate_targets'] == 0
    assert review['current_batch_full_feature_correspondence_reviews_completed'] == 3
    assert review['current_batch_source_limited_targets'] == 0
    assert review['current_batch_follow_up_required_targets'] == review['current_batch_scope_hold_targets'] == 0
    assert review['source_worker_comparison_completed'] is True and review['scalar_product_name_approvals'] == 0
    assert review['park_membership_inferred_from_map_coverage'] is False
    assert source['park_membership_inferred_from_map_coverage'] is False
    for key in ['automatic_application', 'product_application', 'geometry_modified', 'topology_repaired',
                'current_live_deployment_checked', 'historical_verdicts_restored', 'pending_access_reassessment_performed',
                'prior_target_source_or_geometry_reaudit_performed', 'private_original_packed_decoder_independently_replayed']:
        assert review[key] is False
    historical = review['historical_review']
    assert timestamp(historical['performed_at_utc']) == stamp
    assert historical['available_source_inspection_completed'] is True
    assert historical['full_feature_correspondence_review_completed'] is True
    for key in ['original_source_material_included', 'full_selected_geometry_included', 'historical_results_recomputed_by_public_validator']:
        assert historical[key] is False
    assert source['new_external_requests'] == 0 and source['new_original_source_acquisitions_this_batch'] == 0
    assert source['new_external_requests_scope'] and source['distinct_reviewed_publications'] == 1
    assert source['distinct_cartographic_identity_publications'] == source['independent_source_groups'] == 1
    assert source['independent_review_and_source_research_agree'] is True
    for key in ['underlying_hydrographic_dataset_independence_verified', 'formal_registry_verified', 'registered_overlay_performed']:
        assert source[key] is False
    publications = source['observations']
    assert len(publications) == 1 and publications[0]['source_key'] == SOURCE
    park = publications[0]
    assert park['url'] == 'https://dnr.alaska.gov/parks/units/wtc/images/wtcmap2.jpg'
    assert park['official_catalog_url'] == 'https://dnr.alaska.gov/parks/aspunits/southwest/southwestindex.htm'
    assert park['official_host_and_catalog_link_verified'] is True and park['catalog_role']
    assert timestamp(park['original_acquired_at_utc']) <= stamp
    assert park['acquisition_http_status'] == 200 and park['original_acquisition_receipt_reviewed'] is True
    assert park['retrieved_this_batch'] is False and park['reused_original'] is True
    assert park['review_reused_original_acquired_earlier_this_batch'] is False
    assert park['review_reused_original_acquired_in_prior_batch'] is True and park['original_acquisition_batch'] == 'r30'
    assert park['original_map_pixels_viewed'] is True and park['is_formal_naming_registry'] is False
    assert park['government_authored_cartography_verified'] is False
    assert park['publication_date'] is None and park['publication_date_verified'] is False
    assert park['printed_map_date_literal'] == '10/10/11'
    assert all(word in park['cartographic_source'] for word in ['TOPO!', 'National Geographic', 'Tele Atlas'])
    assert park['directly_read_water_labels'] == [name for names in NAMES for name in names]
    assert park['own_observations'] and park['role'] and park['authority_scope']
    assert park['map_coverage_establishes_park_membership'] is False
    columns = [review['findings'], source['complete_feature_observations'], geometry['selected_features'], inventory['records']]
    for column in columns:
        assert [item['aw_id'] for item in column] == IDS
    for index, (finding, observation, feature, row) in enumerate(zip(*columns)):
        hold = False
        for item in [finding, observation, feature, row]:
            assert item['source_id'] == IDS[index].split(':')[1]
        assert finding['baseline_logical_fid'] == feature['baseline_logical_fid'] == row['logical_fid'] == LOGICAL[index]
        assert feature['baseline_fid'] == FIDS[index]
        for item in [finding, observation, row]:
            assert item['geometry_fids'] == [FIDS[index]]
        assert finding['fragment_count'] == feature['fragment_count'] == row['geometry_count'] == 1
        for item in [finding, observation]:
            assert item['polygon_part_count'] == item['ring_count'] == 1
            assert item['position_count_including_closure'] == POSITIONS[index]
            assert item['all_selected_parts_and_rings_considered'] is True
        for key in ['source_geometry', 'baseline_rendered_geometry']:
            summary = feature[key]
            assert summary['type'] == 'Polygon' and summary['polygon_part_count'] == 1
            assert summary['ring_counts_by_part'] == [1] and summary['coordinate_counts_by_part_and_ring'] == [[POSITIONS[index]]]
            assert summary['total_coordinates_including_closure'] == POSITIONS[index] and summary['all_rings_closed'] is True
        assert row['bbox'] == feature['baseline_rendered_geometry']['bbox']
        assert finding['category'] == row['category'] == 'lake'
        assert finding['source_keys'] == observation['source_keys'] == [SOURCE] and finding['context_source_keys'] == []
        assert finding['source_access_limited'] is False and finding['full_feature_correspondence_review_completed'] is True
        assert finding['source_and_rendered_full_footprints_compared'] is True
        assert observation['entire_selected_source_and_rendered_polygons_viewed'] is True
        assert finding['source_observation_id'] == observation['observation_id'] == finding['aw_id']
        assert observation['independent_observation']
        assert finding['supported_name_scope'] and finding['limits'] and finding['follow_up_scope']
        assert finding['park_membership_verified'] is False and finding['park_membership_inferred_from_map_coverage'] is False
        assert finding['geographic_disambiguation'] == 'Aleknagik region, southwestern Alaska, United States; map coverage does not imply park membership'
        assert finding['candidate_names'] == finding['directly_supported_name_forms'] == NAMES[index]
        assert finding['candidate_name'] == (None if hold else NAMES[index][0])
        assert finding['research_category'] == ('compound_feature_name_scope_hold' if hold else 'supported_generalized_water_identity')
        assert finding['review_status'] == ('multiple_named_waters_scalar_name_hold' if hold else 'generalized_identity_supported_not_product_name_clearance')
        assert finding['candidate_name_role'] == ('no_single_candidate_for_compound_footprint' if hold else 'bounded_generalized_selected_water_footprint_identity')
        assert finding['follow_up_required'] is hold
        assert finding['selection_origin'] == 'new_inventory_investigation'
        for key in ['whole_feature_scalar_name', 'scalar_product_name', 'name_ko', 'korean_name', 'name_en', 'name_original']:
            assert finding[key] is None
        for key in ['automatic_application', 'product_application', 'whole_feature_scalar_name_approved', 'formal_registry_verified',
                    'exact_shoreline_verified', 'exact_name_extent_verified', 'geometry_modified', 'bounding_box_alone_used_as_identity',
                    'registered_overlay_performed', 'historical_verified_ID_restored']:
            assert finding[key] is False
        scope = finding['naming_scope_details']
        assert scope['selected_polygon_count'] == 1 and scope['separately_labelled_water_names'] == NAMES[index]
        assert scope['multiple_named_lakes_in_one_polygon'] is hold
        assert scope['one_named_generalized_water_identity_supported'] is (not hold)
        assert scope['whole_polygon_single_name_supported'] is (not hold)
        for key in ['whole_polygon_scalar_application_approved', 'precise_name_boundary_verified', 'formal_registry_verified',
                    'subdivision_or_geometry_repair_performed', 'component_associations_are_exact_geometric_assignments',
                    'independent_cartographic_dataset_confirmed']:
            assert scope[key] is False
        assert scope['entire_detailed_named_lake_representation_verified'] is False
        assert scope['material_extent_limit'] and scope['material_extent_limit'] in finding['supported_name_scope']
        associations = scope['supported_component_associations']
        assert [item['name'] for item in associations] == NAMES[index] and all(item['scope'] for item in associations)
    holds = [item['aw_id'] for item in review['findings'] if item['research_category'] == 'compound_feature_name_scope_hold']
    assert holds == review['new_scope_hold_ids'] == [] and review['new_pending_access_ids'] == []
    assert review['preserved_pending_access_ids'] == continuity['preserved_pending_access_ids'] == ['lakes_base:1159112821', 'lakes_base:1159108815']
    assert review['preserved_scope_hold_ids'] == continuity['preserved_scope_hold_ids']
    assert len(set(review['preserved_scope_hold_ids'])) == len(review['preserved_scope_hold_ids']) == 26
    previous = continuity['previous_aw_ids_in_index_order']
    assert len(previous) == len(set(previous)) == continuity['previous_target_count'] == 90
    assert set(review['preserved_pending_access_ids'] + review['preserved_scope_hold_ids']) <= set(previous)
    assert set(previous).isdisjoint(IDS) and continuity['selected_aw_ids'] == IDS
    assert continuity['intersection_aw_ids'] == [] and continuity['prior_index_duplicate_count'] == 0
    assert continuity['selected_unique_count'] == 3 and continuity['prior_targets_reassessed'] is False
    assert continuity['previous_index_immutable_url'] == 'https://github.com/kimjeon-il/Pando/blob/' + PRIOR + '/reports/hydro-names/reconstruction-2026-10-09/batch-r31/reconstruction-index.json'
    delta = continuity['current_batch_delta']
    assert delta['new_distinct_target_increment'] == 3 and delta['reconstructed_target_count_before'] == 90
    assert delta['reconstructed_target_count_after'] == 93 and delta['initial_eligible_target_count'] == 4065
    assert delta['remaining_fresh_reconstruction_queue_before'] == 3975 and delta['remaining_fresh_reconstruction_queue_after'] == 3972
    assert delta['remaining_queue_types_after'] == {'river_group': 3412, 'lake': 560}
    return {
        'status': 'passed', 'mode': 'included_public_files_only', 'batch': 'r32', 'scope_aw_ids': IDS,
        'recorded_fragment_count': 3, 'recorded_polygon_part_count': 3, 'recorded_ring_count': 3,
        'recorded_position_count_including_closures': 140, 'recorded_full_feature_correspondence_reviews_completed': 3,
        'new_scope_hold_ids': holds, 'generalized_water_identities_supported': 3,
        'distinct_target_increment': 3, 'existing_targets_reassessed': 0,
        'recorded_cumulative_distinct_targets': 93, 'remaining_unrecorded_targets': 3972,
        'original_source_material_reopened': False, 'map_judgments_reproduced': False,
        'omitted_full_polygons_recomputed': False, 'original_decoder_replayed': False,
        'network_requests': 0, 'automatic_application': False,
        'limit': 'Included facts and byte consistency only. Source/map/polygon judgments are recorded, not replayed. Three new inventory IDs have bounded generalized identities in the Aleknagik region of southwestern Alaska; detailed lake extents, exact lake-to-river boundaries, park membership and product naming remain unapproved.',
    }


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r32' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r32' and manifest['scope'] == 'included_public_files_only'
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
