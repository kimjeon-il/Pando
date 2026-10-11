#!/usr/bin/env python3
"""Corruption tests for included lake-review facts; no omitted geographic replay."""
import copy
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent


def run_tests():
    validator = HERE / 'validate-independent-review.py'
    assert validator.is_file(), 'The included lake-review validator is required'
    spec = importlib.util.spec_from_file_location('review', validator)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.validate_records(module.load_records())['status'] == 'passed'
    cases = [
        ('wrong_id', 'review', ('scope_aw_ids', 0), 'lakes_base:0000'),
        ('false_new_coverage', 'review', ('current_batch_increment',), 4),
        ('inflated_total', 'review', ('cumulative_distinct_targets',), 85),
        ('wrong_baseline', 'review', ('baseline_commit',), '0' * 40),
        ('wrong_logical_fid', 'review', ('findings', 0, 'baseline_logical_fid'), 15435),
        ('wrong_position_count', 'review', ('findings', 1, 'position_count_including_closure'), 33),
        ('missing_ring_review', 'review', ('findings', 1, 'all_selected_parts_and_rings_considered'), False),
        ('footprint_scope_erased', 'source', ('complete_feature_observations', 1, 'independent_observation'), 'One lake.'),
        ('compound_candidate', 'review', ('findings', 1, 'candidate_name'), 'Lake Coville'),
        ('compound_hold_removed', 'review', ('findings', 1, 'research_category'), 'supported_generalized_water_identity'),
        ('compound_follow_up_removed', 'review', ('findings', 1, 'follow_up_required'), False),
        ('compound_names_collapsed', 'review', ('findings', 1, 'candidate_names'), ['Lake Grosvenor']),
        ('whole_polygon_name_supported', 'review', ('findings', 1, 'naming_scope_details', 'whole_polygon_single_name_supported'), True),
        ('exact_component_assignment', 'review', ('findings', 1, 'naming_scope_details', 'component_associations_are_exact_geometric_assignments'), True),
        ('scalar_product_name', 'review', ('findings', 0, 'whole_feature_scalar_name'), 'Nonvianuk Lake'),
        ('korean_name', 'review', ('findings', 2, 'name_ko'), 'Brooks'),
        ('unsupported_alias', 'review', ('findings', 2, 'directly_supported_name_forms'), ['Brooks Lake']),
        ('shoreline_certification', 'review', ('findings', 0, 'exact_shoreline_verified'), True),
        ('lost_pending', 'review', ('preserved_pending_access_ids',), []),
        ('lost_prior_holds', 'review', ('preserved_scope_hold_ids',), []),
        ('lost_new_hold', 'review', ('new_scope_hold_ids',), []),
        ('false_duplicate', 'continuity', ('intersection_aw_ids',), ['lakes_base:1159109687']),
        ('wrong_remaining_count', 'continuity', ('current_batch_delta', 'remaining_fresh_reconstruction_queue_after'), 3980),
        ('publications_as_independent_authorities', 'source', ('independent_source_groups',), 2),
        ('context_as_identity_source', 'source', ('distinct_cartographic_identity_publications',), 2),
        ('false_acquisition', 'source', ('observations', 0, 'retrieved_this_batch'), True),
        ('invented_publication_date', 'source', ('observations', 0, 'publication_date'), '2013-02'),
        ('guide_certifies_name', 'source', ('observations', 1, 'directly_read_selected_water_labels'), ['Lake Brooks']),
        ('source_requests', 'source', ('new_external_requests',), 1),
        ('uncompleted_comparison', 'source', ('independent_review_and_source_research_agree',), False),
        ('omitted_replay', 'review', ('historical_review', 'historical_results_recomputed_by_public_validator'), True),
        ('prior_reaudit', 'review', ('prior_target_source_or_geometry_reaudit_performed',), True),
        ('decoder_replayed', 'review', ('private_original_packed_decoder_independently_replayed',), True),
        ('private_fingerprint', 'source', ('original_body_sha256',), '0' * 64),
        ('full_coordinates', 'review', ('findings', 0, 'coordinates'), [[1, 2], [3, 4]]),
        ('automatic_application', 'review', ('automatic_application',), True),
    ]
    rejected = []
    for name, doc, path, value in cases:
        data = copy.deepcopy(module.load_records())
        target = data[doc]
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        try:
            module.validate_records(data)
        except (AssertionError, KeyError, TypeError, ValueError):
            rejected.append(name)
        else:
            raise AssertionError('Corrupt record accepted: ' + name)
    try:
        module.verify_bytes(b'changed', {'bytes': 1, 'sha256': '0' * 64})
    except AssertionError:
        rejected.append('included_byte_integrity')
    else:
        raise AssertionError('Changed included bytes accepted')
    return {
        'status': 'passed',
        'semantic_and_integrity_mutations_rejected': rejected,
        'network_requests': 0,
        'original_map_or_full_polygon_or_decoder_judgments_reproduced': False,
    }


if __name__ == '__main__':
    print(json.dumps(run_tests(), indent=2))
