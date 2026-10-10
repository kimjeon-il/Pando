#!/usr/bin/env python3
"""Current-three fact-corruption tests; omitted maps and complete polygons are not replayed."""
import copy, importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent


def run_tests():
    validator = HERE / 'validate-independent-review.py'
    assert validator.is_file(), 'The r35 current-three public review validator is required'
    spec = importlib.util.spec_from_file_location('review', validator)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    assert m.validate_records(m.load_records())['status'] == 'passed'
    cases = [
        ('wrong_id','review',('scope_aw_ids',0),'lakes_base:0000'),
        ('false_new_coverage','review',('current_batch_increment',),4),
        ('inflated_total','review',('cumulative_distinct_targets',),103),
        ('wrong_baseline','review',('baseline_commit',),'0'*40),
        ('wrong_logical_fid','review',('findings',0,'baseline_logical_fid'),15207),
        ('wrong_position_count','review',('findings',1,'position_count_including_closure'),119),
        ('missing_ring_review','review',('findings',1,'all_selected_parts_and_rings_considered'),False),
        ('drop_tiny_part_count','review',('findings',0,'polygon_part_count'),1),
        ('wrong_multipolygon_type','geometry',('selected_features',0,'source_geometry','type'),'Polygon'),
        ('drop_tiny_ring','geometry',('selected_features',0,'baseline_rendered_geometry','coordinate_counts_by_part_and_ring'),[[253]]),
        ('wrong_part_order','geometry',('selected_features',0,'source_geometry','coordinate_counts_by_part_and_ring'),[[253],[4]]),
        ('missing_observation','source',('complete_feature_observations',1,'independent_observation'),''),
        ('wrong_fact_link','review',('findings',0,'source_observation_id'),'lakes_base:1159109179'),
        ('drop_south_moose','review',('findings',0,'candidate_names'),['North Moose Lake']),
        ('invented_talbot_alias','review',('findings',0,'candidate_names'),['North Moose Lake','South Moose Lake','Talbot Lake']),
        ('invented_davidson_alias','review',('findings',0,'directly_supported_name_forms'),['North Moose Lake','South Moose Lake','Davidson Lake']),
        ('invented_walker_alias','review',('findings',1,'candidate_names'),['Cross Lake','Walker Lake']),
        ('invented_hayes_alias','review',('findings',2,'directly_supported_name_forms'),['Molson Lake','Hayes River']),
        ('compound_scalar_candidate','review',('findings',0,'candidate_name'),'North Moose Lake'),
        ('scalar_product_name','review',('findings',1,'whole_feature_scalar_name'),'Cross Lake'),
        ('korean_name','review',('findings',2,'name_ko'),'Molson'),
        ('shoreline_certification','review',('findings',0,'exact_shoreline_verified'),True),
        ('entire_lake_claim','review',('findings',2,'naming_scope_details','entire_detailed_named_lake_representation_verified'),True),
        ('lost_extent_limit','review',('findings',1,'naming_scope_details','material_extent_limit'),''),
        ('lost_scope_hold','review',('new_scope_hold_ids',),[]),
        ('scope_hold_as_access_pending','review',('new_pending_access_ids',),['lakes_base:1159106799']),
        ('lost_supported_candidate','review',('findings',1,'candidate_name'),None),
        ('lost_compound_identity','review',('findings',0,'naming_scope_details','multiple_named_lakes_in_one_polygon'),False),
        ('exhaustive_moose_names','review',('findings',0,'naming_scope_details','supported_component_names_exhaustive'),True),
        ('assigned_eastern_arm','review',('findings',0,'naming_scope_details','supported_component_associations',1,'scope'),'Southern broad basin and entire eastern arm'),
        ('assigned_tiny_part','review',('findings',0,'naming_scope_details','unresolved_selected_parts',0,'assigned_name'),'South Moose Lake'),
        ('dropped_tiny_part_review','review',('findings',0,'naming_scope_details','unresolved_selected_parts'),[]),
        ('lost_eastern_arm_limit','review',('findings',0,'naming_scope_details','unresolved_named_extents'),[]),
        ('lost_geographic_qualifier','review',('findings',1,'geographic_disambiguation'),''),
        ('lost_follow_up_scope','review',('findings',0,'follow_up_scope'),''),
        ('lost_pending','review',('preserved_pending_access_ids',),[]),
        ('lost_prior_holds','review',('preserved_scope_hold_ids',),[]),
        ('false_duplicate','continuity',('intersection_aw_ids',),['lakes_base:1159106799']),
        ('wrong_remaining_count','continuity',('current_batch_delta','remaining_fresh_reconstruction_queue_after'),3964),
        ('wrong_prior_pin','continuity',('previous_index_immutable_url',),'https://example.invalid'),
        ('inflated_source_groups','source',('independent_source_groups',),2),
        ('false_dataset_independence','source',('underlying_hydrographic_dataset_independence_verified',),True),
        ('wrong_publication_count','source',('distinct_cartographic_identity_publications',),2),
        ('false_reuse','source',('observations',0,'reused_original'),False),
        ('invented_new_acquisition','source',('new_original_source_acquisitions_this_batch',),1),
        ('false_http_success','source',('observations',0,'acquisition_http_status'),403),
        ('registry_claim','source',('observations',0,'is_formal_naming_registry'),True),
        ('invented_geology_day','source',('observations',0,'publication_date'),'2024-10-21'),
        ('wrong_geology_date_precision','source',('observations',0,'publication_date_precision'),'day'),
        ('false_this_batch_retrieval','source',('observations',0,'retrieved_this_batch'),True),
        ('false_same_batch_original','source',('observations',0,'review_reused_original_acquired_earlier_this_batch'),True),
        ('lost_prior_batch_reuse','source',('observations',0,'review_reused_original_acquired_in_prior_batch'),False),
        ('wrong_original_batch','source',('observations',0,'original_acquisition_batch'),'r35'),
        ('invented_batch_external_call','source',('new_external_requests',),1),
        ('invented_backend_http_total','source',('backend_http_subrequest_count',),1),
        ('wrong_external_count_unit','source',('external_request_count_unit',),'http_requests'),
        ('review_external_request','source',('new_external_requests_by_independent_reviewer',),1),
        ('uncompleted_comparison','source',('independent_review_and_source_research_agree',),False),
        ('unregistered_overlay_claim','source',('registered_overlay_performed',),False),
        ('missing_selected_overlay','review',('findings',0,'registered_overlay_performed'),False),
        ('invented_second_source','review',('findings',1,'source_keys'),['manitoba_bedrock_geology_of2024_4','clearwater_park_plan_2013']),
        ('invented_context_source','review',('findings',0,'context_source_keys'),['clearwater_park_plan_2013']),
        ('omitted_replay','review',('historical_review','historical_results_recomputed_by_public_validator'),True),
        ('prior_reaudit','review',('prior_target_source_or_geometry_reaudit_performed',),True),
        ('decoder_replayed','review',('private_original_packed_decoder_independently_replayed',),True),
        ('private_fingerprint','source',('original_body_sha256',),'0'*64),
        ('private_path','source',('local_path',),'/'.join(['','workspace','private'])),
        ('full_coordinates','review',('findings',0,'coordinates'),[[1,2],[3,4]]),
        ('automatic_application','review',('automatic_application',),True),
        ('misspelled_moose','source',('observations',0,'directly_read_water_labels',0),'Northern Moose Lake'),
        ('unsupported_confidence','review',('findings',0,'name_confidence','whole_selected_single_name'),'exact_extent_verified'),
    ]
    rejected = []
    for name, doc, path, value in cases:
        data = copy.deepcopy(m.load_records()); target = data[doc]
        for key in path[:-1]: target = target[key]
        target[path[-1]] = value
        try: m.validate_records(data)
        except (AssertionError, KeyError, TypeError, ValueError): rejected.append(name)
        else: raise AssertionError('Corrupt record accepted: ' + name)
    try: m.verify_bytes(b'changed', {'bytes':1, 'sha256':'0'*64})
    except AssertionError: rejected.append('included_byte_integrity')
    else: raise AssertionError('Changed included bytes accepted')
    return {'status':'passed', 'semantic_and_integrity_mutations_rejected':rejected, 'network_requests':0, 'original_map_or_full_polygon_or_decoder_judgments_reproduced':False}


if __name__ == '__main__': print(json.dumps(run_tests(), indent=2))
