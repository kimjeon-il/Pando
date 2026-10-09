#!/usr/bin/env python3
"""Current-three included-fact corruption tests; omitted map and polygon evidence is not replayed."""
import copy, importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode = True
HERE=Path(__file__).resolve().parent

def run_tests():
    validator=HERE/'validate-independent-review.py'
    assert validator.is_file(), 'The current-three public review validator is required'
    spec=importlib.util.spec_from_file_location('review',validator);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    assert m.validate_records(m.load_records())['status']=='passed'
    cases=[
        ('wrong_id','review',('scope_aw_ids',0),'lakes_base:0000'),
        ('false_new_coverage','review',('current_batch_increment',),4),
        ('inflated_total','review',('cumulative_distinct_targets',),94),
        ('wrong_baseline','review',('baseline_commit',),'0'*40),
        ('wrong_logical_fid','review',('findings',0,'baseline_logical_fid'),15298),
        ('wrong_position_count','review',('findings',1,'position_count_including_closure'),17),
        ('missing_ring_review','review',('findings',1,'all_selected_parts_and_rings_considered'),False),
        ('missing_observation','source',('complete_feature_observations',1,'independent_observation'),''),
        ('wrong_fact_link','review',('findings',0,'source_observation_id'),'lakes_base:1159107889'),
        ('false_compound_name','review',('findings',1,'candidate_names'),['Lake Aleknagik','Nunavaugaluk Lake']),
        ('unsupported_alias','review',('findings',2,'directly_supported_name_forms'),['Nunavaugalak Lake']),
        ('scalar_product_name','review',('findings',0,'whole_feature_scalar_name'),'Lake Nerka'),
        ('korean_name','review',('findings',2,'name_ko'),'Nunavaugaluk'),
        ('shoreline_certification','review',('findings',0,'exact_shoreline_verified'),True),
        ('entire_lake_claim','review',('findings',0,'naming_scope_details','entire_detailed_named_lake_representation_verified'),True),
        ('lost_extent_limit','review',('findings',0,'naming_scope_details','material_extent_limit'),''),
        ('invented_scope_hold','review',('new_scope_hold_ids',),['lakes_base:1159107927']),
        ('lost_single_candidate','review',('findings',0,'candidate_name'),None),
        ('lost_identity_support','review',('findings',0,'naming_scope_details','whole_polygon_single_name_supported'),False),
        ('lost_geographic_qualifier','review',('findings',1,'geographic_disambiguation'),''),
        ('lost_follow_up_scope','review',('findings',0,'follow_up_scope'),''),
        ('lost_pending','review',('preserved_pending_access_ids',),[]),
        ('lost_prior_holds','review',('preserved_scope_hold_ids',),[]),
        ('false_duplicate','continuity',('intersection_aw_ids',),['lakes_base:1159107927']),
        ('wrong_remaining_count','continuity',('current_batch_delta','remaining_fresh_reconstruction_queue_after'),3974),
        ('multiple_authorities','source',('independent_source_groups',),2),
        ('catalog_as_identity_source','source',('distinct_cartographic_identity_publications',),2),
        ('false_reuse','source',('observations',0,'reused_original'),False),
        ('invented_new_acquisition','source',('new_original_source_acquisitions_this_batch',),1),
        ('false_http_success','source',('observations',0,'acquisition_http_status'),403),
        ('government_cartography_claim','source',('observations',0,'government_authored_cartography_verified'),True),
        ('registry_claim','source',('observations',0,'is_formal_naming_registry'),True),
        ('invented_publication_date','source',('observations',0,'publication_date'),'2011-10-10'),
        ('review_external_request','source',('new_external_requests',),1),
        ('uncompleted_comparison','source',('independent_review_and_source_research_agree',),False),
        ('omitted_replay','review',('historical_review','historical_results_recomputed_by_public_validator'),True),
        ('prior_reaudit','review',('prior_target_source_or_geometry_reaudit_performed',),True),
        ('decoder_replayed','review',('private_original_packed_decoder_independently_replayed',),True),
        ('private_fingerprint','source',('original_body_sha256',),'0'*64),
        ('private_path','source',('local_path',),'/'.join(['','workspace','private'])),
        ('full_coordinates','review',('findings',0,'coordinates'),[[1,2],[3,4]]),
        ('automatic_application','review',('automatic_application',),True),
        ('map_membership_inference','source',('observations',0,'map_coverage_establishes_park_membership'),True),
        ('invented_park_membership','review',('findings',1,'park_membership_verified'),True),
        ('misspelled_label','source',('observations',0,'directly_read_water_labels',2),'Nunavaugalak Lake'),
    ]
    rejected=[]
    for name,doc,path,value in cases:
        data=copy.deepcopy(m.load_records());target=data[doc]
        for key in path[:-1]:target=target[key]
        target[path[-1]]=value
        try:m.validate_records(data)
        except (AssertionError,KeyError,TypeError,ValueError):rejected.append(name)
        else:raise AssertionError('Corrupt record accepted: '+name)
    try:m.verify_bytes(b'changed',{'bytes':1,'sha256':'0'*64})
    except AssertionError:rejected.append('included_byte_integrity')
    else:raise AssertionError('Changed included bytes accepted')
    return {'status':'passed','semantic_and_integrity_mutations_rejected':rejected,'network_requests':0,'original_map_or_full_polygon_or_decoder_judgments_reproduced':False}

if __name__=='__main__': print(json.dumps(run_tests(),indent=2))
