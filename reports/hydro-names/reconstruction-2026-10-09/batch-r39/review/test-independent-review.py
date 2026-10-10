#!/usr/bin/env python3
"""Current-three fact mutations only; no omitted map/full-polygon/decoder replay."""
import copy,importlib.util,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent

def run_tests():
    spec=importlib.util.spec_from_file_location('review',HERE/'validate-independent-review.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    assert m.validate_records(m.load_records())['status']=='passed'
    cases=[]
    def add(name,doc,path,value):cases.append((name,doc,path,value))
    for name,path,value in [
        ('wrong_id',('scope_aw_ids',0),'lakes_base:0000'),('false_increment',('current_batch_increment',),4),('inflated_total',('cumulative_distinct_targets',),115),('wrong_baseline',('baseline_commit',),'0'*40),('lost_access_pending',('preserved_pending_access_ids',),[]),('lost_prior_holds',('preserved_scope_hold_ids',),[]),('lost_new_holds',('new_scope_hold_ids',),[]),('lost_material_pending',('new_pending_material_ids',),[]),('material_as_access_failure',('new_pending_access_ids',),[m.IDS[2]]),('material_as_scope_hold',('new_scope_hold_ids',),m.IDS),('automatic_application',('automatic_application',),True),('prior_reaudit',('prior_target_source_or_geometry_reaudit_performed',),True),('decoder_replay',('private_original_packed_decoder_independently_replayed',),True),('all_reviews_complete',('current_batch_full_feature_correspondence_reviews_completed',),3),('false_hold_total',('current_batch_scope_hold_targets',),3),('false_followup_total',('current_batch_follow_up_required_targets',),2),('lost_source_limit',('current_batch_source_limited_targets',),0),('false_material_total',('current_batch_source_material_pending_targets',),0),('historical_full_review_claim',('historical_review','full_feature_correspondence_review_completed'),True)]:add(name,'review',path,value)
    for i in range(3):
        for name,path,value in [
            ('wrong_fid',('geometry_fids',),[0]),('wrong_logical_fid',('baseline_logical_fid',),0),('wrong_positions',('position_count_including_closure',),0),('omitted_rings',('all_selected_parts_and_rings_considered',),False),('wrong_fact_link',('source_observation_id',),'lakes_base:0000'),('wrong_category',('research_category',),'invented'),('scalar_name',('whole_feature_scalar_name',),'Invented Lake'),('candidate_scalar',('candidate_name',),'Invented Lake'),('korean_name',('name_ko',),'이름'),('exact_shore',('exact_shoreline_verified',),True),('lost_extent_limit',('naming_scope_details','material_extent_limit'),''),('whole_name_claim',('naming_scope_details','whole_polygon_single_name_supported'),True),('product_application',('product_application',),True),('wrong_names',('candidate_names',),['Invented Lake']),('full_coordinates',('coordinates',),[[1,2],[3,4]])]:add(name+'_'+str(i),'review',('findings',i)+path,value)
        add('wrong_geometry_type_'+str(i),'geometry',('selected_features',i,'source_geometry','type'),'MultiPolygon')
        add('lost_observation_'+str(i),'source',('complete_feature_observations',i,'independent_observation'),'')
    for name,path,value in [
        ('stanley_mission_alias',('findings',0,'candidate_names'),['Stanley Mission']),('otter_alias',('findings',0,'candidate_names'),['Otter Lake']),('britton_component',('findings',1,'candidate_names'),['Loon Lake','Britton Lake']),('lost_loon_association',('findings',1,'candidate_names'),[]),('lost_primrose_association',('findings',2,'candidate_names'),[]),('loon_material_pending',('findings',1,'source_material_pending'),True),('primrose_as_complete',('findings',2,'full_feature_correspondence_review_completed'),True),('alberta_coverage_claim',('findings',2,'complete_source_map_coverage_available'),True),('primrose_access_failure',('findings',2,'source_access_limited'),True),('lost_primrose_pending',('findings',2,'source_material_pending'),False),('lost_alberta_gap',('findings',2,'naming_scope_details','unresolved_named_extents'),[])]:add(name,'review',path,value)
    for name,path,value in [
        ('false_dataset_independence',('underlying_hydrographic_dataset_independence_verified',),True),('inflated_naming_publications',('distinct_cartographic_identity_publications',),3),('new_acquisition',('new_original_source_acquisitions_this_batch',),1),('external_request',('new_external_requests',),1),('review_external_request',('new_external_requests_by_independent_reviewer',),1),('private_fingerprint',('original_body_sha256',),'0'*64),('private_path',('local_path',),'/'.join(['','workspace','private'])),('invented_geology_day',('observations',0,'publication_date'),'2024-10-21'),('invented_wsa_publication',('observations',1,'publication_date'),'2014-11-25'),('wrong_wsa_production',('observations',1,'printed_production_date'),'2025-05-01'),('wsa_retain_as_acquire',('observations',1,'original_acquisition_batch'),'r17'),('electoral_retain_as_acquire',('observations',2,'original_acquisition_batch'),'r17'),('normalized_ambiguous_date',('observations',2,'printed_creation_date_normalized'),'2023-02-10'),('electoral_publication_claim',('observations',2,'publication_date'),'2023-02-10'),('request_time_as_acquired',('observations',2,'original_acquired_at_utc'),'2026-10-09T17:19:23.772516+00:00'),('false_source_identity_completion',('complete_feature_observations',2,'full_feature_source_identity_review_completed'),True)]:add(name,'source',path,value)
    for i in range(3):
        for name,path,value in [('wrong_url',('url',),'https://example.invalid'),('failed_http',('acquisition_http_status',),403),('registry_claim',('is_formal_naming_registry',),True),('not_viewed',('original_map_pixels_viewed',),False)]:add(name+'_'+str(i),'source',('observations',i)+path,value)
    for name,path,value in [('false_duplicate',('intersection_aw_ids',),[m.IDS[0]]),('wrong_remaining',('current_batch_delta','remaining_fresh_reconstruction_queue_after'),3952),('wrong_lake_remaining',('current_batch_delta','remaining_queue_types_after','lake'),540),('wrong_prior_pin',('previous_index_immutable_url',),'https://example.invalid')]:add(name,'continuity',path,value)
    rejected=[]
    for name,doc,path,value in cases:
        data=copy.deepcopy(m.load_records());target=data[doc]
        for k in path[:-1]:target=target[k]
        target[path[-1]]=value
        try:m.validate_records(data)
        except(AssertionError,KeyError,TypeError,ValueError):rejected.append(name)
        else:raise AssertionError('Corrupt record accepted: '+name)
    try:m.verify_bytes(b'changed',{'bytes':1,'sha256':'0'*64})
    except AssertionError:rejected.append('included_byte_integrity')
    else:raise AssertionError('Changed bytes accepted')
    return {'status':'passed','semantic_and_integrity_mutations_rejected':rejected,'network_requests':0,'original_map_or_full_polygon_or_decoder_judgments_reproduced':False}
if __name__=='__main__':print(json.dumps(run_tests(),indent=2))
