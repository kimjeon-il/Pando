#!/usr/bin/env python3
"""Bounded current-three fact mutations only; no original-source or full-polygon replay."""
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
        ('wrong_id',('scope_aw_ids',0),'lakes_base:0000'),('inflated_total',('cumulative_distinct_targets',),118),('lost_prior_holds',('preserved_scope_hold_ids',),[]),('lost_access_pending',('preserved_pending_access_ids',),[]),('lost_material_pending',('preserved_pending_material_ids',),[]),('material_as_access',('preserved_pending_access_ids',),['lakes_base:1159109285']),('new_false_hold',('new_scope_hold_ids',),[m.IDS[1]]),('false_pending',('new_pending_material_ids',),[m.IDS[1]]),('false_completion',('current_batch_full_feature_correspondence_reviews_completed',),2),('automatic_application',('automatic_application',),True),('prior_reaudit',('prior_target_source_or_geometry_reaudit_performed',),True),('decoder_replay',('private_original_packed_decoder_independently_replayed',),True)]:add(name,'review',path,value)
    for i in range(3):
        for name,path,value in [
            ('wrong_fid',('geometry_fids',),[0]),('wrong_positions',('position_count_including_closure',),0),('omitted_rings',('all_selected_parts_and_rings_considered',),False),('wrong_fact_link',('source_observation_id',),'lakes_base:0000'),('wrong_name',('candidate_names',),['Invented Lake']),('scalar_name',('whole_feature_scalar_name',),'Invented Lake'),('korean_name',('name_ko',),'이름'),('lost_extent_limit',('naming_scope_details','material_extent_limit'),''),('exact_partition',('exact_name_extent_verified',),True),('false_access_failure',('source_access_limited',),True),('false_material_gap',('source_material_pending',),True),('product_application',('product_application',),True),('full_coordinates',('coordinates',),[[1,2],[3,4]])]:add(name+'_'+str(i),'review',('findings',i)+path,value)
        add('wrong_geometry_type_'+str(i),'geometry',('selected_features',i,'source_geometry','type'),'MultiPolygon')
        add('lost_source_observation_'+str(i),'source',('complete_feature_observations',i,'independent_observation'),'')
    add('normalized_wunnummin','review',('findings',1,'candidate_name'),'Wunnumin Lake')
    for name,path,value in [
        ('dataset_independence',('underlying_hydrographic_dataset_independence_verified',),True),('source_count',('distinct_cartographic_identity_publications',),2),('request_count',('new_external_requests',),1),('reviewer_external_request',('new_external_requests_by_independent_reviewer',),1),('backend_count_claim',('backend_http_subrequest_count',),0),('private_fingerprint',('original_body_sha256',),'0'*64),('private_path',('local_path',),'/'.join(['','workspace','private'])),('wrong_url',('observations',0,'url'),'https://example.invalid'),('failed_http',('observations',0,'acquisition_http_status'),403),('registry_claim',('observations',0,'is_formal_naming_registry'),True),('invented_day',('observations',0,'publication_date'),'2021-03-02'),('wrong_scale',('observations',0,'printed_scale'),'1:100,000'),('unseen_pixels',('observations',0,'original_map_pixels_viewed'),False),('unsupported_base_provider',('observations',0,'hydrographic_base_provider'),'invented'),('old_acquisition',('observations',0,'original_acquisition_batch'),'r39')]:add(name,'source',path,value)
    for name,path,value in [('false_duplicate',('intersection_aw_ids',),[m.IDS[0]]),('wrong_remaining',('current_batch_delta','remaining_fresh_reconstruction_queue_after'),3949),('wrong_lake_remaining',('current_batch_delta','remaining_queue_types_after','lake'),537),('wrong_prior_pin',('previous_index_immutable_url',),'https://example.invalid')]:add(name,'continuity',path,value)
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
