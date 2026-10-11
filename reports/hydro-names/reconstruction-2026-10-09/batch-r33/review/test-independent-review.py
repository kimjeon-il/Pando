#!/usr/bin/env python3
"""Current-three fact-corruption tests; omitted maps and complete polygons are not replayed."""
import copy, importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent

def run_tests():
    validator=HERE/'validate-independent-review.py'
    assert validator.is_file(), 'The r33 current-three public review validator is required'
    spec=importlib.util.spec_from_file_location('review',validator); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    assert m.validate_records(m.load_records())['status']=='passed'
    wsa=m.load_records()['source']['observations'][0]
    assert wsa.get('printed_production_date')=='2014-11-25'
    assert wsa['publication_date'] is None and wsa['publication_date_verified'] is False
    cases=[
        ('wrong_id','review',('scope_aw_ids',0),'lakes_base:0000'),
        ('false_new_coverage','review',('current_batch_increment',),4),
        ('inflated_total','review',('cumulative_distinct_targets',),97),
        ('wrong_baseline','review',('baseline_commit',),'0'*40),
        ('wrong_logical_fid','review',('findings',0,'baseline_logical_fid'),15343),
        ('wrong_position_count','review',('findings',1,'position_count_including_closure'),88),
        ('missing_ring_review','review',('findings',1,'all_selected_parts_and_rings_considered'),False),
        ('missing_observation','source',('complete_feature_observations',1,'independent_observation'),''),
        ('wrong_fact_link','review',('findings',0,'source_observation_id'),'lakes_base:1159112235'),
        ('drop_phillips','review',('findings',0,'candidate_names'),['Hatchet Lake']),
        ('invented_tsalwor_alias','review',('findings',1,'candidate_names'),['Tazin Lake','Tsalwor Lake']),
        ('invented_daschuk_alias','review',('findings',2,'directly_supported_name_forms'),['Charcoal Lake','Daschuk Lake']),
        ('compound_scalar_candidate','review',('findings',0,'candidate_name'),'Hatchet Lake'),
        ('scalar_product_name','review',('findings',1,'whole_feature_scalar_name'),'Tazin Lake'),
        ('korean_name','review',('findings',2,'name_ko'),'Charcoal'),
        ('shoreline_certification','review',('findings',0,'exact_shoreline_verified'),True),
        ('entire_lake_claim','review',('findings',2,'naming_scope_details','entire_detailed_named_lake_representation_verified'),True),
        ('lost_extent_limit','review',('findings',1,'naming_scope_details','material_extent_limit'),''),
        ('lost_scope_hold','review',('new_scope_hold_ids',),[]),
        ('hold_as_access_pending','review',('new_pending_access_ids',),['lakes_base:1159108505']),
        ('lost_supported_candidate','review',('findings',1,'candidate_name'),None),
        ('false_whole_identity','review',('findings',0,'naming_scope_details','whole_polygon_single_name_supported'),True),
        ('lost_geographic_qualifier','review',('findings',1,'geographic_disambiguation'),''),
        ('lost_follow_up_scope','review',('findings',0,'follow_up_scope'),''),
        ('lost_pending','review',('preserved_pending_access_ids',),[]),
        ('lost_prior_holds','review',('preserved_scope_hold_ids',),[]),
        ('false_duplicate','continuity',('intersection_aw_ids',),['lakes_base:1159108505']),
        ('wrong_remaining_count','continuity',('current_batch_delta','remaining_fresh_reconstruction_queue_after'),3970),
        ('wrong_prior_pin','continuity',('previous_index_immutable_url',),'https://example.invalid'),
        ('count_maps_as_source_groups','source',('independent_source_groups',),3),
        ('false_dataset_independence','source',('underlying_hydrographic_dataset_independence_verified',),True),
        ('wrong_publication_count','source',('distinct_cartographic_identity_publications',),2),
        ('false_reuse','source',('observations',0,'reused_original'),False),
        ('invented_new_acquisition','source',('new_original_source_acquisitions_this_batch',),1),
        ('false_http_success','source',('observations',0,'acquisition_http_status'),403),
        ('registry_claim','source',('observations',1,'is_formal_naming_registry'),True),
        ('invented_wsa_publication_date','source',('observations',0,'publication_date'),'2014-11-25'),
        ('wrong_wsa_production_date','source',('observations',0,'printed_production_date'),'2014-11-28'),
        ('invented_elections_publication_date','source',('observations',1,'publication_date'),'2023-10-02'),
        ('wrong_printed_date','source',('observations',2,'printed_creation_date'),'2024-10-02'),
        ('review_external_request','source',('new_external_requests',),1),
        ('uncompleted_comparison','source',('independent_review_and_source_research_agree',),False),
        ('unregistered_overlay_claim','source',('registered_overlay_performed',),False),
        ('missing_selected_overlay','review',('findings',0,'registered_overlay_performed'),False),
        ('omitted_replay','review',('historical_review','historical_results_recomputed_by_public_validator'),True),
        ('prior_reaudit','review',('prior_target_source_or_geometry_reaudit_performed',),True),
        ('decoder_replayed','review',('private_original_packed_decoder_independently_replayed',),True),
        ('private_fingerprint','source',('original_body_sha256',),'0'*64),
        ('private_path','source',('local_path',),'/'.join(['','workspace','private'])),
        ('full_coordinates','review',('findings',0,'coordinates'),[[1,2],[3,4]]),
        ('automatic_application','review',('automatic_application',),True),
        ('misspelled_phillips','source',('observations',2,'directly_read_water_labels',1),'Phillip Lake'),
        ('unsupported_confidence','review',('findings',0,'name_confidence','whole_selected_single_name'),'supported'),
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

if __name__=='__main__':print(json.dumps(run_tests(),indent=2))
